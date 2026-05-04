const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
);

const { getCaseHTML, downloadCase, downloadMultipleCases, DOWNLOADS_DIR } = require('./src/download');
const { searchCases } = require('./src/search');
const { scoreRelevancy, scoreFromFullText, scoreFromHeadnotes, generateSynthesisMemo, generateKeywords, chat, chatRefinement, autoRefine } = require('./src/analyzer');
const { getCaseRecord, saveCaseRecord, getHeadnotesByIds, saveHeadnoteRecord, getHtmlFromStorage, saveHtmlToStorage } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state
let cachedSummaries = null;
let chatHistory = [];
let analyzedCases = [];

// Analysis limits / defaults
const MAX_ANALYZE = 5000;          // Maximum cases to analyze in one session
const EXPAND_BATCH = 500;          // How many additional cases to pull per "expand" request
const HEADNOTE_TOPN = 20;          // How many top cases to take from headnote pre-filter
const PAGE_SIZE = 20;              // Centax API page size (must match doSearch logic)
const MAX_RETRIES = 3;             // Retries when downloading case HTML

/**
 * Paginated Centax search helper
 * @param {Object} params
 * @param {Object} params.filter
 * @param {string} params.keywords
 * @param {string} params.sortby
 * @param {number} params.count - how many cases to fetch (max)
 * @param {(progress: {page:number,totalPages:number,fetched:number})=>void} [params.onProgress]
 */
async function paginatedSearch({ filter, keywords, andKeywords = [], sortby, count, startPage = 1, onProgress }) {
    // andKeywords is an array of required phrases.
    // Centax exactSearch only supports ONE phrase, so we use the first chip for the API filter
    // and post-filter results for the remaining chips.
    const andArr = Array.isArray(andKeywords) ? andKeywords : (andKeywords ? [andKeywords] : []);
    const primaryAnd = andArr[0] || '';        // first chip → Centax exactSearch
    const extraAnds = andArr.slice(1);         // remaining chips → post-filter on headnote text

    const results = [];
    const pagesToFetch = Math.ceil(count / PAGE_SIZE);
    const endPage = startPage + pagesToFetch - 1;
    let totalCount = 0;

    for (let p = startPage; p <= endPage; p++) {
        try {
            const searchResult = await searchCases(primaryAnd ? '' : keywords, {
                page: p,
                pageSize: PAGE_SIZE,
                sortby,
                filter,
                advanceSearch: {
                    anyOfSearch: primaryAnd ? keywords : '',
                    exactSearch: primaryAnd,
                    notIncludeSearch: ''
                },
                isAdvSearch: !!primaryAnd
            });

            totalCount = searchResult.totalCount;
            results.push(...searchResult.results);

            if (onProgress) {
                onProgress({ page: p, totalPages: endPage, fetched: results.length });
            }

            if (results.length >= count || results.length >= totalCount) break;
            await new Promise(r => setTimeout(r, 300));
        } catch (err) {
            // Centax returns 409 after many rapid pages — stop gracefully with what we have
            if (err.response?.status === 409) {
                console.log(`⚠️  Centax 409 on page ${p} after ${results.length} results — stopping pagination early`);
                if (onProgress) onProgress({ page: p, totalPages: endPage, fetched: results.length });
                break;
            }
            throw err;
        }
    }

    // Post-filter: remove results that don't contain ALL extra AND phrases in their headnote/heading
    const filtered = extraAnds.length === 0 ? results : results.filter(r => {
        const text = ((r.shortContent || '') + ' ' + (r.heading || '')).toLowerCase();
        return extraAnds.every(phrase => text.includes(phrase.toLowerCase()));
    });

    return { results: filtered, totalCount };
}

/**
 * Multi-AND union search: runs one paginatedSearch per AND phrase, then unions all results.
 * If no andPhrases, falls back to a plain paginatedSearch.
 * @returns {{ results, totalCount, perPhraseCounts: [{phrase, count}] }}
 */
async function multiAndSearch({ filter, keywords, andPhrases = [], sortby, count, onProgress }) {
    if (!andPhrases || andPhrases.length === 0) {
        const { results, totalCount } = await paginatedSearch({ filter, keywords, sortby, count, onProgress });
        return { results, totalCount, perPhraseCounts: [] };
    }

    const perPhrase = [];
    for (const phrase of andPhrases) {
        const { results, totalCount } = await paginatedSearch({
            filter,
            keywords,
            sortby,
            count,
            andKeywords: [phrase],
            onProgress
        });
        perPhrase.push({ phrase, results, totalCount });
    }

    // Union: deduplicate by ID
    const seenIds = new Set();
    const combined = [];
    for (const { results } of perPhrase) {
        for (const r of results) {
            if (!seenIds.has(r.id)) {
                seenIds.add(r.id);
                combined.push(r);
            }
        }
    }

    return {
        results: combined,
        totalCount: combined.length,
        perPhraseCounts: perPhrase.map(p => ({ phrase: p.phrase, count: p.totalCount }))
    };
}

/**
 * Fetch a single case's plain text, using caching layers (DB / storage) and Centax download.
 */
async function fetchCaseText(caseInfo) {
    // ── CACHE LAYER 1: Supabase DB plain_text ──
    const dbRecord = await getCaseRecord(caseInfo.id);
    if (dbRecord && dbRecord.plain_text) {
        console.log(`  ⚡ [DB HIT]  ${caseInfo.id}`);
        return {
            id: dbRecord.id,
            filename: dbRecord.heading || dbRecord.id,
            heading: dbRecord.heading || caseInfo.heading,
            court: dbRecord.court || caseInfo.court,
            date: dbRecord.judgement_date || '',
            text: dbRecord.plain_text,
            fromCache: true,
        };
    }

    // ── CACHE LAYER 2: Supabase Storage HTML bucket ──
    const storedHtml = await getHtmlFromStorage(caseInfo.id);
    if (storedHtml) {
        console.log(`  📦 [STORAGE HIT] ${caseInfo.id}`);
        const plainText = storedHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        // Backfill DB record & trigger embedding (fire-and-forget)
        const judgementDate = caseInfo.date || extractJudgementDate(plainText);
        saveCaseRecord({
            id: caseInfo.id,
            heading: caseInfo.heading,
            court: caseInfo.court,
            judgement_date: judgementDate,
            citation: caseInfo.citation || null,
            short_content: caseInfo.shortContent || null,
            in_favour_of: caseInfo.infavourOf || null,
            category: caseInfo.category || null,
            group_name: caseInfo.groupName || null,
            plain_text: plainText
        }).catch(() => { });
        return {
            id: caseInfo.id,
            filename: caseInfo.heading || caseInfo.id,
            heading: caseInfo.heading,
            court: caseInfo.court,
            date: judgementDate || '',
            text: plainText,
            fromCache: true,
        };
    }

    // ── CACHE MISS: Download from Centax API ──
    console.log(`  🌐 [DOWNLOAD] ${caseInfo.id}`);
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const doc = await getCaseHTML(caseInfo.id);
            const plainText = doc.htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            const judgementDate = caseInfo.date || extractJudgementDate(plainText);
            // Persist to both DB and Storage, then generate embedding (all fire-and-forget)
            saveCaseRecord({
                id: caseInfo.id,
                heading: caseInfo.heading,
                court: caseInfo.court,
                judgement_date: judgementDate,
                citation: caseInfo.citation || null,
                short_content: caseInfo.shortContent || null,
                in_favour_of: caseInfo.infavourOf || null,
                category: caseInfo.category || null,
                group_name: caseInfo.groupName || null,
                plain_text: plainText
            }).catch(() => { });
            saveHtmlToStorage(caseInfo.id, doc.htmlContent).catch(() => { });
            return {
                id: caseInfo.id,
                filename: caseInfo.heading || caseInfo.id,
                heading: caseInfo.heading,
                court: caseInfo.court,
                date: judgementDate || '',
                text: plainText,
            };
        } catch (err) {
            retries++;
            if (retries < MAX_RETRIES) {
                const backoff = Math.min(3000 * Math.pow(2, retries), 15000);
                await new Promise(r => setTimeout(r, backoff));
            } else {
                console.error(`  ❌ Skip case ${caseInfo.id}: ${err.message}`);
                return null;
            }
        }
    }
    return null;
}

/**
 * Extract judgement date from case plain text.
 * Tries common Indian court date patterns, e.g.:
 *   "Decided on: 12 January 2024"
 *   "Date of Decision: 15-03-2023"
 *   "Pronounced on 5th March, 2022"
 *   "ORDER DATED 10.08.2021"
 */
function extractJudgementDate(text) {
    if (!text) return null;
    const sample = text.substring(0, 3000); // date almost always in header

    const patterns = [
        // "Decided on: 12 January 2024" or "Date of Decision: 12.01.2024"
        /(?:decided\s+on|date\s+of\s+(?:decision|judgment|order|pronouncement)|pronounced\s+on|order\s+dated)[:\s]+([\d]{1,2}[\s\-\.thsdndrd]*(?:January|February|March|April|May|June|July|August|September|October|November|December)[\s,]*\d{4})/i,
        // "12 January 2024" or "12th March, 2023" near start
        /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)[,\s]+\d{4})\b/i,
        // DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY
        /(?:decided\s+on|date\s+of\s+(?:decision|judgment|order)|pronounced\s+on|order\s+dated)[:\s]+(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{4})/i,
        // Bare DD.MM.YYYY in first 3000 chars
        /\b(\d{2}[\-\.]\d{2}[\-\.]\d{4})\b/,
    ];

    for (const pattern of patterns) {
        const m = sample.match(pattern);
        if (m && m[1]) return m[1].trim();
    }
    return null;
}

// ──────────────────────── Auth & Config ────────────────────────

// Public: returns Supabase public config for frontend
app.get('/config', (_req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    });
});

// Middleware: verify Supabase JWT on all /api/* routes
async function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(auth.split(' ')[1]);
    if (error || !user) return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    next();
}

app.use('/api', requireAuth);

// User tracking endpoints
app.post('/api/auth/login', async (req, res) => {
    const { id, email, user_metadata } = req.user;
    const { sessionId } = req.body;
    await supabaseAdmin.from('workflowiq_clients').upsert({
        id,
        email,
        full_name: user_metadata?.full_name ?? null,
        avatar_url: user_metadata?.avatar_url ?? null,
        last_seen: new Date().toISOString(),
    }, { onConflict: 'id' });
    await supabaseAdmin.rpc('increment_login_count', { user_id: id });
    await supabaseAdmin.from('workflowiq_login_sessions').insert({
        id: sessionId,
        user_id: id,
        app: 'workflowiq',
    });
    res.json({ ok: true });
});

app.post('/api/auth/heartbeat', async (req, res) => {
    const { sessionId } = req.body;
    await supabaseAdmin.from('workflowiq_login_sessions')
        .update({ last_active: new Date().toISOString() })
        .eq('id', sessionId);
    res.json({ ok: true });
});

app.post('/api/auth/logout', async (req, res) => {
    const { sessionId } = req.body;
    const { data } = await supabaseAdmin
        .from('workflowiq_login_sessions').select('signed_in_at').eq('id', sessionId).single();
    if (data) {
        const durationMin = (Date.now() - new Date(data.signed_in_at).getTime()) / 60000;
        await supabaseAdmin.from('workflowiq_login_sessions')
            .update({ signed_out_at: new Date().toISOString(), duration_min: parseFloat(durationMin.toFixed(2)) })
            .eq('id', sessionId);
    }
    res.json({ ok: true });
});

// ──────────────────────── Search API ────────────────────────

app.post('/api/search', async (req, res) => {
    try {
        const { query, page = 1, pageSize = 20, sortby = 'relevance', filter = {} } = req.body;
        if (!query) return res.status(400).json({ error: 'Search query is required' });

        const results = await searchCases(query, { page, pageSize, sortby, filter });
        res.json(results);
    } catch (err) {
        console.error('Search error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── Case Preview ────────────────────────

app.get('/api/case/:id/preview', async (req, res) => {
    try {
        const id = req.params.id;

        // Try Supabase Storage first
        const cachedHtml = await getHtmlFromStorage(id);
        if (cachedHtml) {
            console.log(`  ⏭️  Preview served from Storage: ${id}`);
            return res.json({
                id,
                html: cachedHtml,
                textLength: cachedHtml.replace(/<[^>]*>/g, '').length
            });
        }

        // Fetch from Centax, then save to Storage for next time
        const doc = await getCaseHTML(id);
        saveHtmlToStorage(id, doc.htmlContent).catch(() => { }); // fire-and-forget
        res.json({
            id,
            html: doc.htmlContent,
            textLength: doc.htmlContent.replace(/<[^>]*>/g, '').length
        });
    } catch (err) {
        console.error('Preview error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── Download ────────────────────────

app.post('/api/download', async (req, res) => {
    try {
        const { caseId, title } = req.body;
        if (!caseId) return res.status(400).json({ error: 'caseId is required' });

        const result = await downloadCase(caseId, title || caseId);
        res.json(result);
    } catch (err) {
        console.error('Download error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── Keyword Generation ────────────────────────

/**
 * POST /api/keywords
 * Body: { narrative: string }
 * Returns AI-generated search keywords from a research narrative.
 */
app.post('/api/keywords', async (req, res) => {
    try {
        const { narrative, model } = req.body;
        if (!narrative) return res.status(400).json({ error: 'narrative is required' });

        console.log(`🔑 Generating keywords for narrative (${narrative.length} chars) [model: ${model || 'default'}]...`);
        const result = await generateKeywords(narrative, model);
        console.log(`✅ Keywords: ${result.keywords}`);
        console.log(`✅ Suggested: ${(result.suggestedKeywords || []).join(', ')}`);
        console.log(`✅ Filters: ${JSON.stringify(result.suggestedFilters || {})}`);
        res.json({
            keywords: result.keywords,
            keywordList: result.keywordList,
            suggestedKeywords: result.suggestedKeywords || [],
            suggestedAndKeywords: result.suggestedAndKeywords || [],
            suggestedFilters: result.suggestedFilters || { module: [], docType: ['Case Laws'], court: [], yearList: [] }
        });
    } catch (err) {
        console.error('Keywords error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── Search Preview (count only) ────────────────────────

/**
 * POST /api/search-preview
 * Body: { keywords: string, andKeywords?: string, filters: object }
 * Returns the totalCount for the given keywords + filters with a single Centax API call.
 * Used by the UI to show "~X cases match" before committing to a full analysis.
 */
app.post('/api/search-preview', async (req, res) => {
    try {
        const { keywords, andKeywords = [], filters = {} } = req.body;
        const andArr = Array.isArray(andKeywords) ? andKeywords : (andKeywords ? [andKeywords] : []);
        if (!keywords && andArr.length === 0) return res.status(400).json({ error: 'keywords is required' });

        const MODULE_IDS = {
            'GST': '111050000000018400',
            'Customs': '111050000000018392',
            'Excise & Service Tax': '111050000000018393',
            'Foreign Trade Policy': '111050000000018795'
        };
        const DOCTYPE_IDS = {
            'Case Laws': '111050000000000060',
            'Notifications': '111050000000000110',
            'Acts': '111050000000000064',
            'Rules': '111050000000000026'
        };
        const COURT_IDS = {
            'Supreme Court': '111270000000000084',
            'High Court': '111270000000000083',
            'Tribunal': '111270000000000082',
            'Advance Ruling': '111270000000000085'
        };

        const apiFilter = {};
        if (filters.module && Array.isArray(filters.module) && filters.module.length > 0) {
            const mapped = filters.module.map(m => MODULE_IDS[m]).filter(Boolean);
            if (mapped.length > 0) apiFilter.categoryList = mapped;
        }
        if (filters.docType && Array.isArray(filters.docType) && filters.docType.length > 0) {
            const mapped = filters.docType.map(d => DOCTYPE_IDS[d]).filter(Boolean);
            if (mapped.length > 0) apiFilter.groupList = mapped;
        }
        if (!apiFilter.groupList || apiFilter.groupList.length === 0) {
            apiFilter.groupList = [DOCTYPE_IDS['Case Laws']];
        }
        if (filters.court && Array.isArray(filters.court) && filters.court.length > 0) {
            const mapped = filters.court.map(c => COURT_IDS[c]).filter(Boolean);
            if (mapped.length > 0) apiFilter.courtList = mapped;
        }
        if (filters.yearList && Array.isArray(filters.yearList) && filters.yearList.length > 0) {
            apiFilter.yearOfPublicationList = filters.yearList.map(y => parseInt(y, 10));
        }

        const { totalCount, perPhraseCounts } = await multiAndSearch({
            filter: apiFilter,
            keywords,
            andPhrases: andArr,
            sortby: 'relevance',
            count: PAGE_SIZE // fetch just 1 page — we only need totalCount
        });

        res.json({ totalCount, perPhraseCounts });
    } catch (err) {
        console.error('Search preview error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── REFINE: Chatbot Search Refinement ────────────────────────

app.post('/api/chat/refine', async (req, res) => {
    try {
        const { message, keywords, currentFilters, model } = req.body;
        if (!message) return res.status(400).json({ error: 'message is required' });
        if (!keywords) return res.status(400).json({ error: 'keywords are required' });

        console.log(`🧠 Refining search based on chat: "${message}"`);
        const result = await chatRefinement(message, keywords, currentFilters || {}, model);
        console.log(`✅ Refinement result:`, result);
        res.json(result);
    } catch (err) {
        console.error('Chat refine error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── ANALYZE: Search → Fetch Text → Summarize → Rank ────────────────────────

app.post('/api/analyze', async (req, res) => {
    try {
        const { keywords, andKeywords = [], context, count = 200, refineCount, filters = {}, customPrompt = null, summaryPrompt = null, model = null, relevancyThreshold = 70 } = req.body;
        const andArr = Array.isArray(andKeywords) ? andKeywords : (andKeywords ? [andKeywords] : []);
        const effectiveRefineCount = refineCount || count; // how many cases to pull on auto-refine pass
        if (!keywords && andArr.length === 0) return res.status(400).json({ error: 'keywords is required' });
        if (!context) return res.status(400).json({ error: 'context is required' });

        // Map user-selected filters to Centax API filter format
        // Centax uses internal numeric IDs for module/docType filters
        const MODULE_IDS = {
            'GST': '111050000000018400',
            'Customs': '111050000000018392',
            'Excise & Service Tax': '111050000000018393',
            'Foreign Trade Policy': '111050000000018795'
        };
        const DOCTYPE_IDS = {
            'Case Laws': '111050000000000060',
            'Notifications': '111050000000000110',
            'Acts': '111050000000000064',
            'Rules': '111050000000000026'
        };

        const COURT_IDS = {
            'Supreme Court': '111270000000000084',
            'High Court': '111270000000000083',
            'Tribunal': '111270000000000082',
            'Advance Ruling': '111270000000000085'
        };
        const ACT_IDS = {
            'Central Goods And Services Tax Act, 2017': '102010000000005574',
            'Integrated Goods and Services Tax Act, 2017': '102010000000005575',
            'Customs Act, 1962': '102010000000000032',
            'Central Excise Act, 1944': '102010000000000019',
            'Finance Act, 1994': '102010000000000037',
            'Uttar Pradesh Goods And Services Tax Act, 2017': '102010000000005638'
        };

        const apiFilter = {};

        if (filters.module && Array.isArray(filters.module) && filters.module.length > 0) {
            const mapped = filters.module.map(m => m === 'all' ? null : MODULE_IDS[m]).filter(Boolean);
            if (mapped.length > 0) apiFilter.categoryList = mapped;
        } else if (typeof filters.module === 'string' && filters.module !== 'all' && MODULE_IDS[filters.module]) {
            apiFilter.categoryList = [MODULE_IDS[filters.module]];
        }

        if (filters.docType && Array.isArray(filters.docType) && filters.docType.length > 0) {
            const mapped = filters.docType.map(d => d === 'all' ? null : DOCTYPE_IDS[d]).filter(Boolean);
            if (mapped.length > 0) apiFilter.groupList = mapped;
        } else if (typeof filters.docType === 'string' && filters.docType !== 'all' && DOCTYPE_IDS[filters.docType]) {
            apiFilter.groupList = [DOCTYPE_IDS[filters.docType]];
        }

        // 🛡️ DEFAULT TO CASE LAWS ONLY to prevent Commentaries/Articles from polluting the search 
        if (!apiFilter.groupList || apiFilter.groupList.length === 0) {
            apiFilter.groupList = [DOCTYPE_IDS['Case Laws']];
        }

        if (filters.court && Array.isArray(filters.court) && filters.court.length > 0) {
            const mapped = filters.court.map(c => c === 'all' ? null : COURT_IDS[c]).filter(Boolean);
            if (mapped.length > 0) apiFilter.courtList = mapped;
        } else if (typeof filters.court === 'string' && filters.court !== 'all' && COURT_IDS[filters.court]) {
            apiFilter.courtList = [COURT_IDS[filters.court]];
        }

        if (filters.act && Array.isArray(filters.act) && filters.act.length > 0) {
            const mapped = filters.act.map(a => (a === 'all' || a === 'not_sure') ? null : ACT_IDS[a]).filter(Boolean);
            if (mapped.length > 0) apiFilter.actList = mapped;
        } else if (typeof filters.act === 'string' && filters.act !== 'all' && filters.act !== 'not_sure' && ACT_IDS[filters.act]) {
            apiFilter.actList = [ACT_IDS[filters.act]];
        }

        // yearList comes as array of year strings like ["2025", "2024"]
        if (filters.yearList && Array.isArray(filters.yearList) && filters.yearList.length > 0) {
            apiFilter.yearOfPublicationList = filters.yearList.map(y => parseInt(y, 10));
        }

        const sortby = filters.sort || 'relevance';

        console.log('🔍 Filters received:', JSON.stringify(filters));
        console.log('🔍 API filter mapped:', JSON.stringify(apiFilter));

        // Stream updates via SSE-like newline-delimited JSON
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Transfer-Encoding', 'chunked');

        const send = (data) => res.write(JSON.stringify(data) + '\n');

        // Step 1: Search (Centax API caps at 20/page, so paginate)
        const hasFilters = Object.keys(apiFilter).length > 0;
        const appliedFilters = hasFilters ? ` with ${Object.keys(apiFilter).length} filters` : '';
        send({ step: 'search', message: `Searching for "${keywords}"${appliedFilters}...` });
        let cases = [];
        let totalCount = 0;

        // Run multi-AND union search (each AND phrase is a separate search; results are unioned)
        let searchData = await multiAndSearch({
            filter: apiFilter,
            keywords,
            andPhrases: andArr,
            sortby,
            count,
            onProgress: ({ page, totalPages, fetched }) => {
                send({ step: 'search', message: `Searching... page ${page}/${totalPages} (${fetched} cases so far)` });
            }
        });
        cases = searchData.results;
        totalCount = searchData.totalCount;

        const perPhraseCounts = searchData.perPhraseCounts || [];
        if (perPhraseCounts.length > 1) {
            const breakdown = perPhraseCounts.map(p => `"${p.phrase}" → ${p.count}`).join(', ');
            send({ step: 'search', message: `AND phrases: ${breakdown} — combined ${cases.length} unique cases` });
        } else if (cases.length < count && cases.length < totalCount) {
            send({ step: 'search', message: `⚠️ Centax rate-limited after ${cases.length} cases — proceeding with what was fetched` });
        }

        // If filtered search returns 0 results, auto-retry without filters
        if (cases.length === 0 && hasFilters) {
            send({ step: 'search', message: '⚠️ Filters too restrictive — retrying without filters...' });
            searchData = await multiAndSearch({
                filter: {},
                keywords,
                andPhrases: andArr,
                sortby,
                count,
                onProgress: ({ page, totalPages, fetched }) => {
                    send({ step: 'search', message: `Searching... page ${page}/${totalPages} (${fetched} cases so far)` });
                }
            });
            cases = searchData.results;
            totalCount = searchData.totalCount;
        }

        // If there are far too many results, ask the user to refine filters first
        if (totalCount > 10000 && andArr.length === 0) {
            send({
                step: 'refine_needed',
                message: `Your search returned ${totalCount} cases (too many to analyze). Please refine your filters to narrow the result set to under 10,000 cases.`,
                totalCount
            });
            return res.end();
        }

        // If AND searches returned fewer cases than requested, analyze all of them; otherwise cap at count
        cases = cases.slice(0, count);

        // Deduplicate cases by ID (API can return duplicates across pages)
        const seenIds = new Set();
        const uniqueCases = [];
        for (const c of cases) {
            if (!seenIds.has(c.id)) {
                seenIds.add(c.id);
                uniqueCases.push(c);
            }
        }
        if (uniqueCases.length < cases.length) {
            console.log(`⚠️ Removed ${cases.length - uniqueCases.length} duplicate case(s)`);
        }
        cases = uniqueCases;
        const headnotePoolCount = cases.length;

        // Save headnote metadata to DB for caching
        for (const c of cases) {
            await saveHeadnoteRecord({
                id: c.id,
                heading: c.heading,
                court: c.court,
                date: c.date,
                citation: c.citation,
                shortContent: c.shortContent,
                infavourOf: c.infavourOf,
                category: c.category,
                groupName: c.groupName,
                parties: c.parties,
                act: c.act,
                raw: c.raw
            });
        }

        send({ step: 'search_done', message: `Found ${totalCount} total results. Narrowing down from top ${cases.length}...`, total: cases.length, totalCount: totalCount });

        if (cases.length === 0) {
            send({ step: 'error', message: 'No results found. Try different keywords.' });
            return res.end();
        }

        // ═══════════════════════════════════════════════════════
        // PHASE 2: INSTANT NARROWING (PRE-FILTER VIA HEADNOTES)
        // ═══════════════════════════════════════════════════════

        send({ step: 'narrowing', message: `Pre-filtering ${cases.length} cases by headnote relevance to find top matches...` });
        console.log(`\n🧠 Phase 2: Passing ${cases.length} headnotes to scoreFromHeadnotes...`);

        const topIds = await scoreFromHeadnotes(context, cases, HEADNOTE_TOPN, model);

        console.log(`🎯 Top ${HEADNOTE_TOPN} IDs selected:`, topIds);

        // Filter the cases array to only include the top ids
        cases = cases.filter(c => topIds.includes(c.id));
        
        if (cases.length === 0) {
            send({ step: 'error', message: 'Could not identify any relevant cases from the headnotes. Try rephrasing your narrative.' });
            return res.end();
        }

        send({ step: 'narrowing_done', message: `Pre-filtering complete. Selected ${cases.length} most relevant cases for deep analysis.` });

        // ═══════════════════════════════════════════════════════
        // PARALLEL FETCH + SCORE PIPELINE (Now only for Top 5)
        // ═══════════════════════════════════════════════════════

        const CONCURRENCY = 5;
        const MAX_RETRIES = 3;
        const scoredResults = [];
        let completed = 0;
        let bestScore = 0;

        /**
         * Fetch a single case text — Cache-First order:
         *   1. Supabase DB (plain_text column)  ← fastest, always checked first
         *   2. Supabase Storage (HTML bucket)   ← fallback if DB text missing
         *   3. Centax API download              ← last resort, result is saved to both DB + Storage
         *
         * After a cache hit, silently triggers embedding generation in the background
         * if the row's `embedding` is NULL (so semantic search improves over time).
         */
        async function fetchCaseText(caseInfo) {
            // ── CACHE LAYER 1: Supabase DB plain_text ──
            const dbRecord = await getCaseRecord(caseInfo.id);
            if (dbRecord && dbRecord.plain_text) {
                console.log(`  ⚡ [DB HIT]  ${caseInfo.id}`);
                return {
                    id: dbRecord.id,
                    filename: dbRecord.heading || dbRecord.id,
                    heading: dbRecord.heading || caseInfo.heading,
                    court: dbRecord.court || caseInfo.court,
                    date: dbRecord.judgement_date || '',
                    text: dbRecord.plain_text,
                    fromCache: true,
                };
            }

            // ── CACHE LAYER 2: Supabase Storage HTML bucket ──
            const storedHtml = await getHtmlFromStorage(caseInfo.id);
            if (storedHtml) {
                console.log(`  📦 [STORAGE HIT] ${caseInfo.id}`);
                const plainText = storedHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                // Backfill DB record & trigger embedding (fire-and-forget)
                const judgementDate = caseInfo.date || extractJudgementDate(plainText);
                saveCaseRecord({
                    id: caseInfo.id,
                    heading: caseInfo.heading,
                    court: caseInfo.court,
                    judgement_date: judgementDate,
                    citation: caseInfo.citation || null,
                    short_content: caseInfo.shortContent || null,
                    in_favour_of: caseInfo.infavourOf || null,
                    category: caseInfo.category || null,
                    group_name: caseInfo.groupName || null,
                    plain_text: plainText
                }).catch(() => { });
                return {
                    id: caseInfo.id,
                    filename: caseInfo.heading || caseInfo.id,
                    heading: caseInfo.heading,
                    court: caseInfo.court,
                    date: judgementDate || '',
                    text: plainText,
                    fromCache: true,
                };
            }

            // ── CACHE MISS: Download from Centax API ──
            console.log(`  🌐 [DOWNLOAD] ${caseInfo.id}`);
            let retries = 0;
            while (retries < MAX_RETRIES) {
                try {
                    const doc = await getCaseHTML(caseInfo.id);
                    const plainText = doc.htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    const judgementDate = caseInfo.date || extractJudgementDate(plainText);
                    // Persist to both DB and Storage, then generate embedding (all fire-and-forget)
                    saveCaseRecord({
                        id: caseInfo.id,
                        heading: caseInfo.heading,
                        court: caseInfo.court,
                        judgement_date: judgementDate,
                        citation: caseInfo.citation || null,
                        short_content: caseInfo.shortContent || null,
                        in_favour_of: caseInfo.infavourOf || null,
                        category: caseInfo.category || null,
                        group_name: caseInfo.groupName || null,
                        plain_text: plainText
                    }).catch(() => { });
                    saveHtmlToStorage(caseInfo.id, doc.htmlContent).catch(() => { });
                    return {
                        id: caseInfo.id,
                        filename: caseInfo.heading || caseInfo.id,
                        heading: caseInfo.heading,
                        court: caseInfo.court,
                        date: judgementDate || '',
                        text: plainText,
                    };
                } catch (err) {
                    retries++;
                    if (retries < MAX_RETRIES) {
                        const backoff = Math.min(3000 * Math.pow(2, retries), 15000);
                        await new Promise(r => setTimeout(r, backoff));
                    } else {
                        console.error(`  ❌ Skip case ${caseInfo.id}: ${err.message}`);
                        return null;
                    }
                }
            }
            return null;
        }

        /**
         * Process a single case: fetch text → score against narrative
         * Returns the scored result augmented with the source (cached vs downloaded).
         */
        async function processCase(caseInfo) {
            const caseText = await fetchCaseText(caseInfo);
            if (!caseText) return null;

            // Score directly from full text
            const scoreResult = await scoreFromFullText(context, caseText.text, caseText.id, model);

            completed++;
            const score = scoreResult.score || 0;
            if (score > bestScore) bestScore = score;

            const sourceTag = caseText.fromCache ? '💾' : '🌐';
            send({
                step: 'score_progress',
                message: `Evaluating relevance (${completed}/${cases.length} cases)`,
                progress: completed,
                total: cases.length,
                pct: 10 + Math.round((completed / cases.length) * 70)
            });

            // 🔔 Early result flash — emit immediately if score meets threshold
            if (score >= relevancyThreshold) {
                send({
                    step: 'high_relevancy',
                    score,
                    heading: caseText.heading,
                    court: caseText.court,
                    date: caseText.date,
                    id: caseText.id,
                    reason: scoreResult.reason,
                    category: scoreResult.category,
                    threshold: relevancyThreshold,
                    message: `🎯 High relevancy found: "${caseText.heading?.substring(0, 50)}" scored ${score}/100`
                });
            }

            console.log(`  ✅ [${completed}/${cases.length}] ${caseText.heading?.substring(0, 50)} → ${score}/100 (${scoreResult.category})`);

            return {
                id: caseText.id,
                filename: caseText.filename,
                heading: caseText.heading,
                court: caseText.court,
                date: caseText.date,
                text: caseText.text,
                score: scoreResult.score,
                category: scoreResult.category,
                reason: scoreResult.reason,
                miniSummary: scoreResult.miniSummary,
                analysis: scoreResult.analysis,
            };
        }

        // ── Execute parallel fetch+score ──
        send({ step: 'score_start', message: `Fetching full text and evaluating relevance for ${cases.length} selected cases...` });
        console.log(`\n⚡ Parallel fetch+score: ${cases.length} cases, concurrency=${CONCURRENCY}`);

        for (let i = 0; i < cases.length; i += CONCURRENCY) {
            const batch = cases.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(batch.map(processCase));

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    scoredResults.push(result.value);
                }
            }

            // Small delay between batches to respect rate limits
            if (i + CONCURRENCY < cases.length) {
                await new Promise(r => setTimeout(r, 500));
            }
        }

        if (scoredResults.length === 0) {
            send({ step: 'error', message: 'Could not fetch or score any cases.' });
            return res.end();
        }

        // ── Sort by score descending ──
        scoredResults.sort((a, b) => (b.score || 0) - (a.score || 0));

        send({ step: 'score_done', message: `Relevance evaluation complete. Top case scored ${scoredResults[0]?.score}/100.` });
        console.log(`\n📊 Scoring complete. Top case: ${scoredResults[0]?.heading} (${scoredResults[0]?.score}/100)`);

        // Generate Deep Synthesis Memo
        send({ step: 'synthesis', message: `Generating AI synthesis memo based on top cases...` });
        const synthesisMemo = await generateSynthesisMemo(context, scoredResults.slice(0, 5), model === 'gpt-4o-mini' ? 'gpt-4o' : model);
        
        send({ step: 'synthesis_done', message: `Synthesis Memo ready.` });

        // Build rank result in the expected format
        let rankResult = {
            synthesisMemo: synthesisMemo,
            rankings: scoredResults.map(r => ({
                id: r.id,
                filename: r.filename,
                heading: r.heading,
                court: r.court,
                date: r.date,
                score: r.score,
                category: r.category,
                reason: r.reason,
                summary: r.miniSummary || '',  // Use miniSummary instead
            }))
        };

        // ─── AUTO-REFINEMENT LOOP ───
        // Removed: Now interactive expansion via UI

        // Store for follow-up chat
        chatHistory = [];
        chatHistory.push({ role: 'user', content: context });
        chatHistory.push({ role: 'assistant', content: JSON.stringify(rankResult) });
        analyzedCases = scoredResults;

        const analyzedCount = Math.min(headnotePoolCount, MAX_ANALYZE);
        const nextPage = Math.ceil(count / PAGE_SIZE) + 1;
        const canExpand = totalCount > analyzedCount && analyzedCount < MAX_ANALYZE;

        send({
            step: 'done',
            message: 'Analysis complete! Results ready.',
            data: rankResult,
            totalAnalyzed: scoredResults.length,
            analyzedCount,
            nextPage,
            canExpand,
            maxAnalyzed: MAX_ANALYZE,
            totalCount
        });
        res.end();
    } catch (err) {
        console.error('Analyze error:', err.message);
        res.write(JSON.stringify({ step: 'error', message: err.message }) + '\n');
        res.end();
    }
});

// ──────────────────────── Expand Search (Interactive) ────────────────────────

/**
 * POST /api/expand
 * Body: {
 *   keywords, context, filters,
 *   page, totalCount,
 *   analyzedIds, analyzedCount,
 *   maxAnalyzed?
 * }
 *
 * Fetches the next batch of cases (EXPAND_BATCH) and returns scored results.
 * Designed to be called repeatedly by the UI to grow the analysis set.
 */
app.post('/api/expand', async (req, res) => {
    try {
        const {
            keywords,
            context,
            filters = {},
            page = 1,
            totalCount = null,
            analyzedIds = [],
            analyzedCount = 0,
            maxAnalyzed = MAX_ANALYZE
        } = req.body;

        if (!keywords) return res.status(400).json({ error: 'keywords is required' });
        if (!context) return res.status(400).json({ error: 'context is required' });

        // If the total result set is enormous, force refinement first
        if (totalCount && totalCount > 10000) {
            return res.json({
                step: 'refine_needed',
                message: `Your search returned ${totalCount} cases (too many to analyze). Please refine your filters to narrow the result set to under 10,000 cases.`,
                totalCount
            });
        }

        const remaining = Math.max(0, maxAnalyzed - analyzedCount);
        if (remaining <= 0) {
            return res.json({
                step: 'expand_done',
                message: `Reached maximum allowed analysis limit of ${maxAnalyzed} cases.`,
                canExpand: false,
                analyzedCount,
                totalCount
            });
        }

        const batchSize = Math.min(EXPAND_BATCH, remaining);
        const sortby = filters.sort || 'relevance';

        // Fetch next chunk of results from Centax
        const searchData = await paginatedSearch({
            filter: filters,
            keywords,
            sortby,
            count: batchSize,
            startPage: page
        });

        let newTotalCount = totalCount || searchData.totalCount;
        let cases = searchData.results;

        // Deduplicate against already analyzed IDs
        const seen = new Set(analyzedIds || []);
        const beforeFilterCount = cases.length;
        cases = cases.filter(c => !seen.has(c.id));

        // Deduplicate within this batch
        const uniqueIds = new Set();
        cases = cases.filter(c => {
            if (uniqueIds.has(c.id)) return false;
            uniqueIds.add(c.id);
            return true;
        });

        const headnotePoolCount = cases.length;

        // Cache headnotes
        for (const c of cases) {
            await saveHeadnoteRecord({
                id: c.id,
                heading: c.heading,
                court: c.court,
                date: c.date,
                citation: c.citation,
                shortContent: c.shortContent,
                infavourOf: c.infavourOf,
                category: c.category,
                groupName: c.groupName,
                parties: c.parties,
                act: c.act,
                raw: c.raw
            });
        }

        // Pre-filter via headnotes (batch scoring)
        const topIds = await scoreFromHeadnotes(context, cases, HEADNOTE_TOPN);
        cases = cases.filter(c => topIds.includes(c.id));

        // Fetch full-text + score for these top cases
        const scoredResults = [];
        const CONCURRENCY = 5;

        async function processCase(caseInfo) {
            const caseText = await fetchCaseText(caseInfo);
            if (!caseText) return null;
            const scoreResult = await scoreFromFullText(context, caseText.text, caseText.id);
            return {
                id: caseText.id,
                filename: caseText.filename,
                heading: caseText.heading,
                court: caseText.court,
                date: caseText.date,
                score: scoreResult.score,
                category: scoreResult.category,
                reason: scoreResult.reason,
                miniSummary: scoreResult.miniSummary,
                analysis: scoreResult.analysis
            };
        }

        for (let i = 0; i < cases.length; i += CONCURRENCY) {
            const batch = cases.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(batch.map(processCase));
            for (const r of results) {
                if (r.status === 'fulfilled' && r.value) scoredResults.push(r.value);
            }
            if (i + CONCURRENCY < cases.length) await new Promise(r => setTimeout(r, 500));
        }

        scoredResults.sort((a, b) => (b.score || 0) - (a.score || 0));

        const pagesFetched = Math.ceil(beforeFilterCount / PAGE_SIZE);
        const nextPage = page + pagesFetched;
        const newAnalyzedCount = analyzedCount + headnotePoolCount;
        const canExpand = newAnalyzedCount < maxAnalyzed && newTotalCount > newAnalyzedCount;

        res.json({
            step: 'expand_done',
            message: `Expansion complete. Processed ${headnotePoolCount} new cases.`,
            scoredResults,
            analyzedCount: newAnalyzedCount,
            nextPage,
            canExpand,
            maxAnalyzed,
            totalCount: newTotalCount
        });
    } catch (err) {
        console.error('Expand error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── Relevancy Score: Single Case (Prompt 2) ────────────────────────

/**
 * POST /api/score
 * Body: { narrative: string, caseId?: string, caseSummary?: string }
 *
 * Evaluates how strongly a single case aligns with the research narrative.
 * If caseId is provided, looks up the summary from the last analysis run.
 * If caseSummary is provided directly, uses that.
 */
app.post('/api/score', async (req, res) => {
    try {
        const { narrative, caseId, caseSummary } = req.body;
        if (!narrative) return res.status(400).json({ error: 'narrative is required' });

        let summary = caseSummary;

        // If no inline summary, look up from last analysis cache
        if (!summary && caseId) {
            if (!cachedSummaries || !cachedSummaries[caseId]) {
                return res.status(404).json({ error: `Case ID "${caseId}" not found in current session. Run analysis first or provide caseSummary directly.` });
            }
            summary = cachedSummaries[caseId].summary;
        }

        if (!summary) {
            return res.status(400).json({ error: 'Either caseId (from an analyzed session) or caseSummary is required' });
        }

        console.log(`⚖️  Scoring relevancy for case: ${caseId || '(inline summary)'}`);
        const result = await scoreRelevancy(narrative, summary, caseId || '');
        res.json(result);
    } catch (err) {
        console.error('Score error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── AI Chat Follow-up ────────────────────────

app.post('/api/chat/message', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'message is required' });
        if (!cachedSummaries) return res.status(400).json({ error: 'Run analysis first' });

        const response = await chat(cachedSummaries, chatHistory, message);
        chatHistory.push({ role: 'user', content: message });
        chatHistory.push({ role: 'assistant', content: response });
        res.json({ type: 'chat', data: response });
    } catch (err) {
        console.error('Chat error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────── Downloaded files list ────────────────────────

app.get('/api/files', (req, res) => {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(f => f.endsWith('.pdf'))
            .map(f => {
                const stats = fs.statSync(path.join(DOWNLOADS_DIR, f));
                const idMatch = f.match(/Case_(\d+)_/);
                return { filename: f, id: idMatch?.[1], size: stats.size };
            });
        res.json(files);
    } catch {
        res.json([]);
    }
});

// ──────────────────────── Serve UI ────────────────────────

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    // Standalone: node researchiq/server.js
    app.listen(PORT, () => {
        console.log(`\n🚀 ResearchIQ running at http://localhost:${PORT}\n`);
    });
} else {
    // Embedded: required by root server.js — export the app
    module.exports = app;
}
