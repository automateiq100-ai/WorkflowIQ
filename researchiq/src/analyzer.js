const OpenAI = require('openai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { getSummary, saveSummary, getSummariesMap } = require('./db');

// Use secondary key; fall back to primary if secondary not set
const apiKey = process.env.OPENAI_API_KEY_SECONDARY || process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey });

// Default model — can be overridden per-request from the frontend
const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Summarize a single case using OpenAI
 */
async function summarizeCase(text, filename, keywords = '', context = '', customPrompt = null, model = null) {
    // Truncate very long texts to avoid token limits (keep first ~12K chars)
    const truncated = text.length > 12000 ? text.substring(0, 12000) + '\n...[truncated]' : text;

    const DEFAULT_SUMMARY_SYSTEM = `You are a senior Indian legal analyst specializing in tax litigation (GST, Customs, Excise, Service Tax). Your sole job is to extract and summarize the legally material substance of a judgment so that a downstream AI can accurately assess its relevance to a given research narrative.

Critical rules:
- ALWAYS produce a structured summary. Never say a case is "not relevant" and stop — the downstream ranker will decide relevance.
- Do NOT invent facts. If a field is absent from the judgment, write "Not stated".
- Focus only on ratio decidendi. Ignore procedural orders, interim orders, and obiter dicta unless they are the central issue.
- Capture exact statutory provisions (Act name + section number) relied upon by the court.
- Explicitly note whether the final outcome is FAVOURABLE to the taxpayer or ADVERSE (or Mixed).`;

    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: customPrompt || DEFAULT_SUMMARY_SYSTEM
            },
            {
                role: 'user',
                content: `Research Keywords: ${keywords}
Research Narrative: ${context}

Judgment Text:
${truncated}

Produce a structured summary using EXACTLY these six headings (keep each entry concise but complete):

1. CASE IDENTITY
   Case name, citation (if available), court name, bench (judge names if visible), and date of judgment.

2. LEGAL ISSUES
   List each legal question decided by the court (one line per issue).

3. FACTS IN BRIEF
   2–4 sentences covering the transaction, dispute, and procedural history relevant to the legal issues.

4. STATUTORY PROVISIONS
   List every Act + Section the court relied upon or interpreted (e.g., CGST Act s.54, Customs Act s.128).

5. RATIO / HELD
   The court's actual holding on each issue. Quote the key operative finding verbatim if available. State whether the outcome is FAVOURABLE / ADVERSE / MIXED for the taxpayer.

6. KEY PRINCIPLE
   One to three sentences capturing the legal rule or ratio decidendi that can be cited as precedent.`
            }
        ],
        temperature: 0.1,
        max_tokens: 800
    });

    return response.choices[0].message.content;
}

/**
 * Summarize all cases, using cache where available
 *
 * @param {Array<{filename, id, text}>} cases - Extracted PDF texts
 * @param {string} keywords - Search keywords for relevance filtering
 * @param {string} context - User's research narrative/context
 * @returns {Object} Map of id -> {filename, summary}
 */
async function summarizeAll(cases, keywords = '', context = '', customPrompt = null, onProgress = null, model = null) {
    // Load all existing summaries for these IDs from Supabase in one query
    const BATCH_SIZE = 5;
    const freshSummaries = {};

    console.log(`🧠 Summarizing ${cases.length} cases via OpenAI (${BATCH_SIZE} in parallel)...\n`);
    let completed = 0;

    for (let i = 0; i < cases.length; i += BATCH_SIZE) {
        const batch = cases.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(cases.length / BATCH_SIZE);
        console.log(`  📦 Batch ${batchNum}/${totalBatches} (${batch.length} cases)...`);

        const results = await Promise.allSettled(
            batch.map(c => summarizeCase(c.text, c.filename, keywords, context, customPrompt, model))
        );

        // Save each fresh result to Supabase (for embeddings / semantic search)
        await Promise.all(results.map(async (result, j) => {
            const c = batch[j];
            if (result.status === 'fulfilled') {
                freshSummaries[c.id] = { filename: c.filename, summary: result.value };
                await saveSummary(c.id, result.value);
                completed++;
                console.log(`    ✅ ${c.filename}`);
            } else {
                console.log(`    ❌ ${c.filename}: ${result.reason?.message || 'Unknown error'}`);
            }
        }));

        if (i + BATCH_SIZE < cases.length) {
            await new Promise(r => setTimeout(r, 200));
        }

        if (onProgress) onProgress(completed, cases.length);
    }

    console.log(`\n✅ Summaries ready: ${completed}/${cases.length}\n`);
    return freshSummaries;
}

/**
 * Rank cases by relevance to user's described situation (Independent Scoring)
 *
 * @param {Object} summaries - Map of id -> {filename, summary}
 * @param {string} userContext - User's case description
 * @returns {Object} { rankings, recommendation }
 */
async function rankByRelevance(summaries, userContext, customSystemPrompt = null, model = null) {
    const ids = Object.keys(summaries);
    const BATCH_SIZE = 10;
    const rankings = [];

    console.log(`\n⚖️  Independently scoring ${ids.length} cases against the narrative...`);

    // Process in batches so we don't hit rate limits or timeout OpenAI
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batchIds = ids.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(batchIds.map(id => {
            return scoreRelevancy(userContext, summaries[id].summary, id, model);
        }));

        for (const res of results) {
            // Map the scoreRelevancy output to the ranking format expected by the frontend
            rankings.push({
                id: res.caseId,
                filename: summaries[res.caseId].filename,
                score: res.score || 0,
                category: res.category || "Unknown",
                reason: res.analysis?.support_rationale || "No rationale provided."
            });
        }
    }

    // Sort by absolute score descending (most relevant first)
    rankings.sort((a, b) => b.score - a.score);

    return {
        rankings,
        recommendation: "Cases have been individually evaluated and scored against your research narrative."
    };
}

/**
 * Chat with the analyzer (follow-up questions)
 *
 * @param {Object} summaries - Case summaries
 * @param {Array} history - Chat history
 * @param {string} userMessage - New user message
 */
async function chat(summaries, history, userMessage, model = null) {
    const ids = Object.keys(summaries);
    const summaryBlock = ids.map((id, i) => {
        const s = summaries[id];
        return `[Case ${i + 1}] ID: ${id} | ${s.filename}\n${s.summary}`;
    }).join('\n---\n');

    const systemMsg = {
        role: 'system',
        content: `You are an expert Indian legal research assistant. You have access to summaries of ${ids.length} legal cases. Help the user find the most relevant cases for their situation. Always provide relevancy scores (0-100) when ranking cases.

## Available Cases:
${summaryBlock}`
    };

    const messages = [systemMsg, ...history, { role: 'user', content: userMessage }];

    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 2000
    });

    return response.choices[0].message.content;
}

/**
 * Process a user's chat message to refine the search parameters
 *
 * @param {string} message - User's chat message
 * @param {string} currentKeywords - The current search keywords
 * @param {Object} currentFilters - The current active filters
 * @returns {Object} { newKeywords, newFilters, replyMessage }
 */
async function chatRefinement(message, currentKeywords, currentFilters = {}, model = null) {
    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: `You are an expert Indian tax law AI assistant. 
The user has just run a search using keywords: "${currentKeywords}".
Active filters: ${JSON.stringify(currentFilters)}

They want to refine their search based on their new message.
1. Update the keywords if they mention new facts, sections, or concepts. ALL keywords MUST be single words (e.g., "debit", "note", not "debit note").
2. Update filters if they mention specific jurisdictions, courts, or document types.
   AVAILABLE FILTERS & EXACT VALUES:
   - "module": ["GST", "Excise & Service Tax", "Customs", "Foreign Trade Policy"]
   - "docType": ["Case Laws", "Notifications", "Acts", "Rules"]
   - "court": ["Supreme Court", "High Court", "Tribunal", "Advance Ruling"]
   - "yearList": ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015"]

Return a JSON object:
{
  "newKeywords": "updated space separated single words",
  "newFilters": { "court": ["High Court"], "module": ["GST"] },
  "replyMessage": "A brief, natural reply to the user explaining what you updated (e.g., 'I have filtered for High Court cases and added the keyword \"penalty\". Rerunning the search now...')"
}`
            },
            {
                role: 'user',
                content: message
            }
        ],
        temperature: 0.2,
        max_tokens: 500
    });

    const content = response.choices[0].message.content;
    try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(jsonStr);
    } catch {
        console.error('Failed to parse chat refinement:', content);
        return {
            newKeywords: currentKeywords,
            newFilters: currentFilters,
            replyMessage: "I couldn't quite understand that. Retrieving results as earlier."
        };
    }
}

/**
 * Relevancy Scoring & Judicial Evaluation Agent (Prompt 2)
 *
 * Evaluates how strongly a single case summary aligns with the research narrative.
 * Acts as an impartial constitutional court — neutral, analytical, and independent.
 *
 * @param {string} narrative - The user's research narrative / legal argument
 * @param {string} caseSummary - Structured case summary (output from summarizeCase / Prompt 1)
 * @param {string} [caseId] - Optional case ID for reference
 * @returns {Object} { score, category, analysis, raw }
 */
async function scoreRelevancy(narrative, caseSummary, caseId = '', model = null) {
    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: `You are a STRICT and IMPARTIAL Indian legal evaluator. Your job is to assess whether a case precedent is genuinely useful for the user's specific legal argument. You must NOT inflate scores.

## SCORING METHODOLOGY (follow this checklist rigorously):

STEP 1 — CORE ISSUE MATCH (worth 40 points max):
- Identify the SPECIFIC legal question in the Research Narrative.
- Identify the SPECIFIC legal question decided in the Case Summary.
- Do they address the SAME specific legal question? 
  - Exact same question = 35-40 pts
  - Closely related question = 20-34 pts  
  - Same broad area but different question = 5-19 pts
  - Completely different question = 0-4 pts
- IMPORTANT: Two cases can both involve "debit notes" or "GST rates" but address completely DIFFERENT legal questions. Sharing a topic keyword is NOT the same as sharing the core legal issue.

STEP 2 — FACTUAL SIMILARITY (worth 25 points max):
- Are the underlying facts (transaction type, parties, dispute context) similar?
  - Very similar facts = 20-25 pts
  - Somewhat similar = 10-19 pts
  - Different facts = 0-9 pts

STEP 3 — STATUTORY OVERLAP (worth 20 points max):
- Does the case interpret the SAME statutory provisions (exact Act + Section)?
  - Same provisions = 15-20 pts
  - Related provisions = 5-14 pts
  - Different provisions = 0-4 pts

STEP 4 — PRACTICAL UTILITY (worth 15 points max):
- Can this case actually be CITED to support the narrative's argument?
  - Directly citable = 12-15 pts
  - Partially useful = 5-11 pts
  - Not useful = 0-4 pts

FINAL SCORE = Sum of Steps 1-4 (0-100).

CATEGORY based on final score:
- 90-100: Direct (exact same issue, facts, and statute)
- 70-89: Strong (same core issue, similar facts)
- 50-69: Moderate (related issue, distinguishable facts)
- 30-49: Weak (same broad area, different specific question)
- 0-29: Not Relevant (different legal question entirely)

## ANTI-INFLATION RULES:
- A case that merely MENTIONS the same keywords (e.g. "debit note", "GST rate") but decides a DIFFERENT legal question MUST score below 30.
- A case in the same area of law (e.g. GST) but about a completely different provision or issue MUST score below 40.
- Only award 70+ if the case would genuinely be cited in a legal brief supporting the narrative.
- Only award 90+ if a lawyer would call this case "directly on point".

Respond ONLY in raw JSON (no markdown):
{
  "score": <number 0-100>,
  "category": "<Direct | Strong | Moderate | Weak | Not Relevant | Adverse>",
  "analysis": {
    "issue_alignment": "<what is the narrative's core question vs the case's core question — are they the same?>",
    "factual_alignment": "<how similar are the underlying facts?>",
    "statutory_alignment": "<do they interpret the same Act + Section?>",
    "distinguishing_factors": "<what makes this case different from the narrative's situation?>",
    "support_rationale": "<would a lawyer actually cite this case to support the narrative? why or why not?>"
  }
}`
            },
            {
                role: 'user',
                content: `Research Narrative: ${narrative}\n\nCase Summary:\n${caseSummary}`
            }
        ],
        temperature: 0.2,
        max_tokens: 1000
    });

    const content = response.choices[0].message.content;

    try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        return {
            caseId,
            score: parsed.score,
            category: parsed.category,
            analysis: parsed.analysis,
            raw: null
        };
    } catch {
        // Fallback: return raw text if JSON parsing fails
        return {
            caseId,
            score: null,
            category: null,
            analysis: null,
            raw: content
        };
    }
}

/**
 * Generate Search Keywords from Narrative (Phase 1 Wide Net)
 *
 * Takes the user's research narrative and returns targeted search keywords
 * suitable for the Centax legal database search API. We want a WIDE NET
 * since we will pre-filter headnotes later.
 *
 * @param {string} narrative - The user's legal research narrative / argument
 * @returns {{ keywords: string, keywordList: string[] }}
 */
async function generateKeywords(narrative, model = null) {
    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: `You are a senior Indian indirect tax lawyer extracting search terms for a legal database.
We want to cast a WIDE NET. The search engine uses OR / AND logic.

RULES FOR KEYWORDS (keywordList):
1. Extract the 2 to 4 most essential single words directly from the narrative — use the EXACT words that appear in the narrative, not paraphrases or synonyms.
2. Example: for "debit note GST rate" the keywords are ["debit", "note", "GST", "rate"] — NOT ["invoice", "liability"].
3. ALWAYS include the tax acronym if present or clearly implied (GST, CGST, IGST, ITC, CENVAT, customs, excise). Never omit it.
4. We want to retrieve MANY cases (200-600), so keep terms broad enough.
5. Each term MUST be a single word. No phrases.

RULES FOR suggestedKeywords (OR suggestions):
- Provide 5 to 8 ADDITIONAL optional single-word synonyms or related terms the user may want to add.
- These should be alternative phrasings, related legal concepts, or synonyms not already in keywordList.

RULES FOR suggestedAndKeywords (AND phrase suggestions for exact search):
- Provide exactly 5 to 8 specific phrases the user might want to use in the AND exact-search box.
- These are CANDIDATES — the user picks which ones to add, so be generous and varied.
- Include ALL of the following types where applicable:
  1. Exact legal phrases from the narrative (e.g. "debit note", "input tax credit", "zero rated supply")
  2. Specific section/rule numbers relevant to the issue (e.g. "section 54", "rule 96", "section 16(4)")
  3. Well-known landmark case names or parties likely to appear in relevant judgments (e.g. "Safari Retreats", "Mohit Minerals")
  4. Specific legal doctrines or tests (e.g. "pre-deposit", "reverse charge", "place of supply")
  5. Relevant statutory terms of art (e.g. "credit note", "composite supply", "mixed supply")
- Phrases should be 1–5 words. No full sentences.
- Do NOT suggest single generic words like "GST" or "tax" alone.
- Always return at least 5 suggestions. If the narrative is broad, still return 5+ plausible phrases.

RULES FOR FILTER SUGGESTIONS (suggestedFilters):
- ONLY include a filter value if you are 100% certain it applies to this narrative.
- module: ONLY include if the narrative is unambiguously about ONE specific tax law. If it could apply to GST AND Customs, leave module empty []. Options: "GST", "Customs", "Excise & Service Tax", "Foreign Trade Policy"
- docType: Always include "Case Laws" unless the narrative is explicitly about notifications/acts/rules. Options: "Case Laws", "Notifications", "Acts", "Rules"
- court: ONLY include if the narrative explicitly names a court level. Options: "Supreme Court", "High Court", "Tribunal", "Advance Ruling"
- yearList: ONLY include specific years if the narrative mentions a time period. Options: year strings like "2024", "2023", etc.

Return ONLY raw JSON (no markdown):
{
  "keywordList": ["term1", "term2", "term3"],
  "searchQuery": "term1 term2 term3",
  "suggestedKeywords": ["syn1", "syn2", "related1", "related2", "related3"],
  "suggestedAndKeywords": ["phrase1", "section 54", "landmark case name", "legal doctrine", "statutory term"],
  "suggestedFilters": {
    "module": [],
    "docType": ["Case Laws"],
    "court": [],
    "yearList": []
  }
}`
            },
            {
                role: 'user',
                content: `Research Narrative: ${narrative}`
            }
        ],
        temperature: 0.2,
        max_tokens: 600
    });

    const content = response.choices[0].message.content;
    try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        const keywordList = parsed.keywordList || [];
        const searchQuery = parsed.searchQuery || keywordList.join(' ');
        return {
            keywords: searchQuery,
            keywordList,
            suggestedKeywords: parsed.suggestedKeywords || [],
            suggestedAndKeywords: parsed.suggestedAndKeywords || [],
            suggestedFilters: parsed.suggestedFilters || { module: [], docType: ['Case Laws'], court: [], yearList: [] }
        };
    } catch {
        const words = content.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 5);
        return {
            keywords: words.join(' '),
            keywordList: words,
            suggestedKeywords: [],
            suggestedAndKeywords: [],
            suggestedFilters: { module: [], docType: ['Case Laws'], court: [], yearList: [] }
        };
    }
}

/**
 * Auto-Refinement Agent
 *
 * When the initial search results are poor (top score < threshold), this function
 * analyzes the narrative vs the retrieved case summaries and generates better
 * keywords and filters to improve results on the next attempt.
 *
 * @param {string} narrative - The user's research narrative
 * @param {string} currentKeywords - Current search keywords
 * @param {Object} currentFilters - Current filters applied
 * @param {Array} topRankings - Top ranked results with scores and reasons
 * @returns {Object} { newKeywords, newFilters, refinementReason }
 */
async function autoRefine(narrative, currentKeywords, currentFilters = {}, topRankings = [], model = null) {
    const topCaseSummary = topRankings.slice(0, 3).map((r, i) =>
        `Case ${i + 1}: Score ${r.score}/100 | ${r.heading || r.filename} | Reason: ${r.reason}`
    ).join('\n');

    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: `You are an expert Indian tax law search optimization agent.

The user searched for case laws matching their research narrative, but the top results are NOT relevant enough (low scores).

Your job: analyze WHY the search failed and produce BETTER search keywords and filters.

CURRENT SEARCH STATE:
- Keywords used: "${currentKeywords}"
- Filters applied: ${JSON.stringify(currentFilters)}
- Top results and their relevance scores:
${topCaseSummary}

REFINEMENT STRATEGY:
1. Identify the SPECIFIC legal question in the narrative.
2. Look at what the top results were about — understand why they were retrieved but scored low.
3. Generate NEW keywords that are more specific to the exact legal question.
4. If the narrative mentions a specific court type, act, or time period, add those as filters.

KEYWORD RULES:
- ALL keywords MUST be single words (no phrases with spaces).
- Focus on the EXACT legal concepts, section numbers, and specific terminology.
- Add section numbers relevant to the issue (e.g., "34", "12", "15").
- Include specific legal terms that distinguish this issue from related but different issues.

AVAILABLE FILTERS:
- "module": ["GST", "Excise & Service Tax", "Customs", "Foreign Trade Policy"]
- "court": ["Supreme Court", "High Court", "Tribunal", "Advance Ruling"]

Return ONLY raw JSON:
{
  "newKeywords": "single word1 word2 word3 ...",
  "newFilters": { "module": ["GST"] },
  "refinementReason": "Brief explanation of what you changed and why"
}`
            },
            {
                role: 'user',
                content: `Research Narrative: ${narrative}`
            }
        ],
        temperature: 0.3,
        max_tokens: 400
    });

    const content = response.choices[0].message.content;
    try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(jsonStr);
    } catch {
        console.error('Failed to parse auto-refinement:', content);
        return {
            newKeywords: currentKeywords,
            newFilters: currentFilters,
            refinementReason: 'Auto-refinement failed to produce new parameters.'
        };
    }
}

/**
 * Phase 2: Instant Narrowing
 * Evaluate up to 200-600 case headnotes against the narrative in a single prompt.
 * 
 * @param {string} narrative - The user's research narrative
 * @param {Array} casesData - Array of case objects containing id, heading, and shortContent (headnote)
 * @returns {Array} List of Top 5 case IDs that are highly relevant
 */
async function scoreFromHeadnotes(narrative, casesData, topN = 5, model = null, andKeywords = []) {
    if (!casesData || casesData.length === 0) return [];

    // Construct the payload of headnotes
    const headnotesList = casesData.map(c => {
        // Fallback to heading if shortContent is somehow missing
        const snippet = (c.shortContent || c.heading || '').substring(0, 300).trim();
        return `[ID: ${c.id}] ${c.heading} \nHeadnote: ${snippet}`;
    }).join('\n\n');

    const andRequirement = andKeywords.length > 0
        ? `\n\nMANDATORY: Only select cases whose headnote contains ALL of these required phrases: ${andKeywords.map(k => `"${k}"`).join(', ')}. Exclude any case that does not contain all of them.`
        : '';

    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: `You are an expert Indian tax lawyer acting as a fast pre-filter.
You will be given a user's research narrative and a list of case headnotes (200-300 characters each).

Your ONLY job is to select the TOP ${topN} most relevant cases based *strictly* on resolving the specific legal issue in the narrative.${andRequirement}

Return ONLY a raw JSON array of string IDs (no markdown, no explanations):
["case_id_1", "case_id_2", "case_id_3"]`
            },
            {
                role: 'user',
                content: `Research Narrative:\n${narrative}\n\n────────────────────────\nCase Headnotes:\n${headnotesList}`
            }
        ],
        temperature: 0.1,
        max_tokens: 150
    });

    try {
        const content = response.choices[0].message.content;
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        let topIds = JSON.parse(jsonStr);
        if (!Array.isArray(topIds)) topIds = [];
        return topIds.slice(0, topN); // Guarantee max topN
    } catch (err) {
        console.error('Failed to parse scoreFromHeadnotes:', err);
        return casesData.slice(0, topN).map(c => c.id); // Fallback to first topN
    }
}


/**
 * Score a case directly from its full plain text (no summary needed).
 * This replaces the summarize→score pipeline with a single LLM call.
 *
 * @param {string} narrative - The user's legal research narrative
 * @param {string} fullText - Plain text of the case judgment
 * @param {string} [caseId] - Optional case ID for reference
 * @param {string} [model] - Optional model override
 * @returns {Object} { caseId, score, category, reason, miniSummary, analysis }
 */
async function scoreFromFullText(narrative, fullText, caseId = '', model = null) {
    // Truncate to ~30K chars to stay within token limits
    const truncated = fullText.length > 30000
        ? fullText.substring(0, 30000) + '\n...[truncated]'
        : fullText;

    const response = await openai.chat.completions.create({
        model: model || DEFAULT_MODEL,
        messages: [
            {
                role: 'system',
                content: `You are a STRICT and IMPARTIAL Indian legal evaluator. You are given the FULL TEXT of a case judgment and a user's Research Narrative. Evaluate whether this case is genuinely useful for the user's specific legal argument. You must NOT inflate scores.

## SCORING METHODOLOGY (follow this checklist rigorously):

STEP 1 — CORE ISSUE MATCH (worth 40 points max):
- Identify the SPECIFIC legal question in the Research Narrative.
- Identify the SPECIFIC legal question decided in the Case Judgment.
- Do they address the SAME specific legal question? 
  - Exact same question = 35-40 pts
  - Closely related question = 20-34 pts  
  - Same broad area but different question = 5-19 pts
  - Completely different question = 0-4 pts
- IMPORTANT: Two cases can both involve "debit notes" or "GST rates" but address completely DIFFERENT legal questions. Sharing a topic keyword is NOT the same as sharing the core legal issue.

STEP 2 — FACTUAL SIMILARITY (worth 25 points max):
- Are the underlying facts (transaction type, parties, dispute context) similar?
  - Very similar facts = 20-25 pts
  - Somewhat similar = 10-19 pts
  - Different facts = 0-9 pts

STEP 3 — STATUTORY OVERLAP (worth 20 points max):
- Does the case interpret the SAME statutory provisions (exact Act + Section)?
  - Same provisions = 15-20 pts
  - Related provisions = 5-14 pts
  - Different provisions = 0-4 pts

STEP 4 — PRACTICAL UTILITY (worth 15 points max):
- Can this case actually be CITED to support the narrative's argument?
  - Directly citable = 12-15 pts
  - Partially useful = 5-11 pts
  - Not useful = 0-4 pts

FINAL SCORE = Sum of Steps 1-4 (0-100).

CATEGORY based on final score:
- 90-100: Direct (exact same issue, facts, and statute)
- 70-89: Strong (same core issue, similar facts)
- 50-69: Moderate (related issue, distinguishable facts)
- 30-49: Weak (same broad area, different specific question)
- 0-29: Not Relevant (different legal question entirely)

## ANTI-INFLATION RULES:
- A case that merely MENTIONS the same keywords (e.g. "debit note", "GST rate") but decides a DIFFERENT legal question MUST score below 30.
- A case in the same area of law (e.g. GST) but about a completely different provision or issue MUST score below 40.
- Only award 70+ if the case would genuinely be cited in a legal brief supporting the narrative.
- Only award 90+ if a lawyer would call this case "directly on point".

Respond ONLY in raw JSON (no markdown):
{
  "score": <number 0-100>,
  "category": "<Direct | Strong | Moderate | Weak | Not Relevant | Adverse>",
  "reason": "<one sentence explaining why a lawyer would or would not cite this case>",
  "miniSummary": "<2-3 sentences: what is this case about? what was decided?>",
  "analysis": {
    "issue_alignment": "<narrative's core question vs case's core question>",
    "factual_alignment": "<how similar are the facts?>",
    "statutory_alignment": "<same Act + Section?>",
    "support_rationale": "<would a lawyer cite this? why/why not?>"
  }
}`
            },
            {
                role: 'user',
                content: `Research Narrative:\n${narrative}\n\n────────────────────────\nFull Case Judgment Text:\n${truncated}`
            }
        ],
        temperature: 0.2,
        max_tokens: 800
    });

    const content = response.choices[0].message.content;

    try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        return {
            caseId,
            score: parsed.score,
            category: parsed.category,
            reason: parsed.reason || parsed.analysis?.support_rationale || '',
            miniSummary: parsed.miniSummary || '',
            analysis: parsed.analysis,
            raw: null
        };
    } catch {
        return {
            caseId,
            score: null,
            category: null,
            reason: null,
            miniSummary: null,
            analysis: null,
            raw: content
        };
    }
}

/**
 * Phase 3: Deep Synthesis (The Memo)
 * Generates a comprehensive synthesis memo analyzing how the Top 5 cases
 * apply to the user's research narrative.
 * 
 * @param {string} narrative - The user's research narrative
 * @param {Array} topCases - The array of scored cases (needs text or summary)
 * @returns {string} The markdown-formatted synthesis memo
 */
async function generateSynthesisMemo(narrative, topCases, model = 'gpt-4o') {
    if (!topCases || topCases.length === 0) return "No cases found to synthesize.";

    // Build the context payload. We use truncated text or mini-summaries to fit the context window
    const casesContext = topCases.map((c, i) => {
        const contentInfo = c.text 
            ? c.text.substring(0, 15000) + (c.text.length > 15000 ? '\n...[truncated]' : '') 
            : (c.summary || c.miniSummary || 'No text available');
        
        return `[Case ${i + 1}] ${c.heading} (Score: ${c.score}/100) \n\nCONTENT:\n${contentInfo}\n\n`;
    }).join('────────────────────────\n');

    const systemPrompt = `You are a Senior Partner at a top tier Indian tax law firm. 
A junior associate has provided you with a research narrative outlining a client's situation, along with the Top 5 most relevant case precedents.

Your job is to write a highly professional, concise, and structured Synthesis Memo advising on the situation based ONLY on these 5 cases.

STRUCTURE YOUR MEMO WITH THESE HEADINGS:
1. Executive Summary - 2-3 sentences providing the bottom-line answer.
2. Application of Precedent - Explain how the specific cases support or hinder the client's narrative. Cite the cases explicitly by name.
3. Key Risks or Distinguishing Factors - Based on the cases, what are the weak points in our argument?
4. Conclusion - A crisp, one-sentence takeaway.

TONE: Objective, analytical, firm, and authoritative. Use markdown formatting.`;

    try {
        const response = await openai.chat.completions.create({
            model: model, // Prefer gpt-4o for complex synthesis
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `CLIENT NARRATIVE:\n${narrative}\n\n────────────────────────\nRELEVANT PRECEDENTS:\n${casesContext}` }
            ],
            temperature: 0.2, // Low temperature for factual accuracy
            max_tokens: 1500
        });

        return response.choices[0].message.content;
    } catch (err) {
        console.error('Failed to generate synthesis memo:', err);
        return "Failed to generate synthesis memo due to an error. Please review the individual cases below.";
    }
}

module.exports = { summarizeCase, summarizeAll, rankByRelevance, scoreRelevancy, scoreFromFullText, scoreFromHeadnotes, generateSynthesisMemo, generateKeywords, chat, chatRefinement, autoRefine };
