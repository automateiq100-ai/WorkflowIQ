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
 * Generate Search Keywords from Narrative (Prompt 0 — Keyword Agent)
 *
 * Takes the user's research narrative and returns targeted search keywords
 * suitable for the Centax legal database search API.
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
                content: `You are a senior Indian indirect tax lawyer. Your task is to extract search terms for a legal case database (Centax).

The search engine uses OR logic — documents containing ANY of the terms will be returned. So:
- FEWER, BROADER terms find MORE documents
- MANY specific terms find FEWER documents (bad)

RULES:
1. Extract 3 to 5 CORE LEGAL CONCEPTS from the narrative
2. Each term can be 1-2 words max (e.g., "debit note", "GST rate", "valuation")
3. Use the most legally significant terms — the ones a lawyer would search for
4. Also produce a short display label for each keyword the user can see
5. Avoid stop words, determiners, and overly generic words

Return ONLY raw JSON (no markdown):
{
  "keywordList": ["term1", "term2", "term3"],
  "searchQuery": "term1 term2 term3"
}`
            },
            {
                role: 'user',
                content: `Research Narrative: ${narrative}`
            }
        ],
        temperature: 0.1,
        max_tokens: 200
    });

    const content = response.choices[0].message.content;
    try {
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);
        const keywordList = parsed.keywordList || [];
        const searchQuery = parsed.searchQuery || keywordList.join(' ');
        return {
            keywords: searchQuery,
            keywordList
        };
    } catch {
        const words = content.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, 5);
        return { keywords: words.join(' '), keywordList: words };
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

module.exports = { summarizeCase, summarizeAll, rankByRelevance, scoreRelevancy, scoreFromFullText, generateKeywords, chat, chatRefinement, autoRefine };
