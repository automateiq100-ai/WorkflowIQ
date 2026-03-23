const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────
//  Case Records (plain text + metadata)
// ─────────────────────────────────────────────

/**
 * Get a case record by Centax ID.
 * Returns the full row or null if not found.
 */
async function getCaseRecord(id) {
    const { data, error } = await supabase
        .from('cases')
        .select('*')
        .eq('id', id)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = row not found
        console.error(`[db] getCaseRecord error for ${id}:`, error.message);
    }
    return data || null;
}

/**
 * Upsert case metadata + plain text.
 * @param {{ id, heading, court, date, module, doc_type, plain_text }} obj
 */
async function saveCaseRecord(obj) {
    const { error } = await supabase
        .from('cases')
        .upsert({
            id: obj.id,
            heading: obj.heading || null,
            court: obj.court || null,
            judgement_date: obj.judgement_date || null,
            plain_text: obj.plain_text,
            fetched_at: new Date().toISOString()
        }, { onConflict: 'id' });

    if (error) console.error(`[db] saveCaseRecord error for ${obj.id}:`, error.message);
}

// ─────────────────────────────────────────────
//  Summaries
// ─────────────────────────────────────────────

/**
 * Get a case summary by ID.
 * Returns { summary, filename } or null.
 */
async function getSummary(id) {
    const { data, error } = await supabase
        .from('cases')
        .select('summary, heading')
        .eq('id', id)
        .not('summary', 'is', null)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error(`[db] getSummary error for ${id}:`, error.message);
    }
    if (!data) return null;
    return { summary: data.summary, filename: data.heading || id };
}

/**
 * Save (update) a case summary.
 */
async function saveSummary(id, summary) {
    const { error } = await supabase
        .from('cases')
        .upsert({
            id,
            summary,
            summarized_at: new Date().toISOString()
        }, { onConflict: 'id', ignoreDuplicates: false });

    if (error) console.error(`[db] saveSummary error for ${id}:`, error.message);
}

/**
 * Load all summaries for a list of case IDs.
 * Returns a map of id -> { summary, filename }.
 */
async function getSummariesMap(ids) {
    if (!ids || ids.length === 0) return {};

    const { data, error } = await supabase
        .from('cases')
        .select('id, summary, heading')
        .in('id', ids)
        .not('summary', 'is', null);

    if (error) {
        console.error('[db] getSummariesMap error:', error.message);
        return {};
    }

    const map = {};
    for (const row of data || []) {
        map[row.id] = { summary: row.summary, filename: row.heading || row.id };
    }
    return map;
}

// ─────────────────────────────────────────────
//  HTML Storage (Supabase Storage bucket: "cases")
// ─────────────────────────────────────────────

/**
 * Download HTML for a case from Storage.
 * Returns HTML string or null if not found.
 */
async function getHtmlFromStorage(id) {
    const { data, error } = await supabase.storage
        .from('cases')
        .download(`${id}.html`);

    if (error) return null; // Not found or other error
    return await data.text();
}

/**
 * Upload HTML for a case to Storage.
 */
async function saveHtmlToStorage(id, html) {
    const { error } = await supabase.storage
        .from('cases')
        .upload(`${id}.html`, html, {
            contentType: 'text/html',
            upsert: true
        });

    if (error) console.error(`[db] saveHtmlToStorage error for ${id}:`, error.message);
}

// ─────────────────────────────────────────────
//  Embeddings & Semantic Search (pgvector)
// ─────────────────────────────────────────────

/**
 * Generate an embedding for a case summary and store it in Supabase.
 * Uses text-embedding-3-small (1536 dims, cheap and fast).
 * No-ops if the case already has an embedding.
 */
async function embedCase(id, summaryText) {
    if (!summaryText) return;

    // Check if already embedded
    const { data } = await supabase
        .from('cases')
        .select('embedded_at')
        .eq('id', id)
        .not('embedding', 'is', null)
        .single();
    if (data) return; // already embedded

    try {
        const res = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: summaryText.substring(0, 8000),
            dimensions: 1536,  // reduced from 3072 to fit pgvector HNSW limit
        });
        const vector = res.data[0].embedding;

        await supabase.from('cases').upsert({
            id,
            embedding: vector,
            embedded_at: new Date().toISOString()
        }, { onConflict: 'id', ignoreDuplicates: false });
    } catch (err) {
        console.error(`[db] embedCase error for ${id}:`, err.message);
    }
}

/**
 * Semantic search: find top-K cases most similar to the narrative.
 * Returns array of { id, heading, court, judgement_date, summary, similarity }
 */
async function semanticSearch(narrativeText, topK = 25, minSimilarity = 0.25) {
    try {
        // Embed the narrative
        const res = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: narrativeText.substring(0, 8000),
            dimensions: 1536,
        });
        const queryEmbedding = res.data[0].embedding;

        // Call the match_cases SQL function via Supabase RPC
        const { data, error } = await supabase.rpc('match_cases', {
            query_embedding: queryEmbedding,
            match_count: topK,
            min_similarity: minSimilarity
        });

        if (error) {
            console.error('[db] semanticSearch error:', error.message);
            return [];
        }
        return data || [];
    } catch (err) {
        console.error('[db] semanticSearch error:', err.message);
        return [];
    }
}

module.exports = {
    getCaseRecord,
    saveCaseRecord,
    getSummary,
    saveSummary,
    getSummariesMap,
    getHtmlFromStorage,
    saveHtmlToStorage,
    embedCase,
    semanticSearch
};
