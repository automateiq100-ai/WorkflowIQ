const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { searchCases } = require('./src/search');
const { getCaseHTML, downloadCase, downloadMultipleCases, DOWNLOADS_DIR } = require('./src/download');
const { summarizeCase, summarizeAll, rankByRelevance, scoreRelevancy, scoreFromFullText, generateKeywords, chat, chatRefinement, autoRefine } = require('./src/analyzer');
const { getCaseRecord, saveCaseRecord, getHtmlFromStorage, saveHtmlToStorage, embedCase, semanticSearch } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state
let cachedSummaries = null;
let chatHistory = [];
let analyzedCases = [];

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
        res.json(result);
    } catch (err) {
        console.error('Keywords error:', err.message);
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
        const { keywords, context, count = 100, filters = {}, customPrompt = null, summaryPrompt = null, model = null, relevancyThreshold = 80 } = req.body;
        if (!keywords) return res.status(400).json({ error: 'keywords is required' });
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
            apiFilter.yearList = filters.yearList;
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
        const PAGE_SIZE = 20;
        let cases = [];
        let totalCount = 0;

        // Helper to run paginated search
        async function doSearch(filterObj, searchKeywords = keywords) {
            const searchCases_ = [];
            const totalPgs = Math.ceil(count / PAGE_SIZE);
            let tc = 0;
            for (let p = 1; p <= totalPgs; p++) {
                // Pass keywords via anyOfSearch for OR logic
                // (searchData requires ALL words to be present = AND = too restrictive)
                const searchResult = await searchCases('', {
                    page: p,
                    pageSize: PAGE_SIZE,
                    sortby,
                    filter: filterObj,
                    advanceSearch: {
                        anyOfSearch: searchKeywords,
                        exactSearch: '',
                        notIncludeSearch: ''
                    },
                    isAdvSearch: true
                });
                tc = searchResult.totalCount;
                searchCases_.push(...searchResult.results);
                send({ step: 'search', message: `Searching... page ${p}/${totalPgs} (${searchCases_.length} cases so far)` });
                if (searchCases_.length >= count || searchCases_.length >= tc) break;
                await new Promise(r => setTimeout(r, 300));
            }
            return { results: searchCases_, totalCount: tc };
        }

        // Run filtered search
        let searchData = await doSearch(apiFilter);
        cases = searchData.results;
        totalCount = searchData.totalCount;

        // If filtered search returns 0 results, auto-retry without filters
        if (cases.length === 0 && hasFilters) {
            send({ step: 'search', message: '⚠️ Filters too restrictive — retrying without filters...' });
            searchData = await doSearch({});
            cases = searchData.results;
            totalCount = searchData.totalCount;
        }

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

        send({ step: 'search_done', message: `Found ${totalCount} total results. Analyzing top ${cases.length}.`, total: cases.length, totalCount: totalCount });

        if (cases.length === 0) {
            send({ step: 'error', message: 'No results found. Try different keywords.' });
            return res.end();
        }

        // ═══════════════════════════════════════════════════════
        // PARALLEL FETCH + SCORE PIPELINE
        // Each case is fetched and scored independently, in batches of 5
        // ═══════════════════════════════════════════════════════

        const CONCURRENCY = 5;
        const MAX_RETRIES = 3;
        const scoredResults = [];
        let completed = 0;
        let bestScore = 0;

        /**
         * Fetch a single case text (from storage cache or Centax API)
         */
        async function fetchCaseText(caseInfo) {
            // Check storage cache first
            const storedHtml = await getHtmlFromStorage(caseInfo.id);
            if (storedHtml) {
                const plainText = storedHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                const judgementDate = extractJudgementDate(plainText);
                return {
                    id: caseInfo.id,
                    filename: caseInfo.heading || caseInfo.id,
                    heading: caseInfo.heading,
                    court: caseInfo.court,
                    date: judgementDate || '',
                    text: plainText,
                };
            }

            // Fetch from Centax API with retries
            let retries = 0;
            while (retries < MAX_RETRIES) {
                try {
                    const doc = await getCaseHTML(caseInfo.id);
                    const plainText = doc.htmlContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
                    const judgementDate = extractJudgementDate(plainText);
                    // Save to storage (fire-and-forget)
                    saveHtmlToStorage(caseInfo.id, doc.htmlContent).catch(() => { });
                    saveCaseRecord({
                        id: caseInfo.id,
                        heading: caseInfo.heading,
                        court: caseInfo.court,
                        judgement_date: judgementDate,
                        plain_text: plainText
                    }).catch(() => { });
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
                        console.error(`  Skip case ${caseInfo.id}: ${err.message}`);
                        return null;
                    }
                }
            }
            return null;
        }

        /**
         * Process a single case: fetch text → score against narrative
         */
        async function processCase(caseInfo) {
            const caseText = await fetchCaseText(caseInfo);
            if (!caseText) return null;

            // Score directly from full text
            const scoreResult = await scoreFromFullText(context, caseText.text, caseText.id, model);

            completed++;
            const score = scoreResult.score || 0;
            if (score > bestScore) bestScore = score;

            send({
                step: 'score_progress',
                message: `⚡ Scored ${completed}/${cases.length} — "${caseText.heading?.substring(0, 40) || caseText.id}": ${score}/100`,
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
        send({ step: 'score_start', message: `Fetching & scoring ${cases.length} cases in parallel…` });
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

        send({ step: 'score_done', message: `All ${scoredResults.length} cases scored. Best: ${scoredResults[0]?.score}/100` });
        console.log(`\n📊 Scoring complete. Top case: ${scoredResults[0]?.heading} (${scoredResults[0]?.score}/100)`);

        // ── Generate summaries for top 5 only (for display) ──
        const TOP_N_SUMMARIES = 5;
        const topCases = scoredResults.slice(0, TOP_N_SUMMARIES);
        send({ step: 'summarize', message: `Generating detailed summaries for top ${topCases.length} cases…` });

        await Promise.allSettled(topCases.map(async (c) => {
            try {
                const summary = await summarizeCase(c.text, c.filename, keywords, context, summaryPrompt, model);
                c.summary = summary;
            } catch (err) {
                console.error(`  Summary failed for ${c.id}: ${err.message}`);
                c.summary = c.miniSummary || '';
            }
        }));

        send({ step: 'summarize_done', message: `Summaries ready for top ${topCases.length} cases.` });

        // Build rank result in the expected format
        let rankResult = {
            rankings: scoredResults.map(r => ({
                id: r.id,
                filename: r.filename,
                heading: r.heading,
                court: r.court,
                date: r.date,
                score: r.score,
                category: r.category,
                reason: r.reason,
                summary: r.summary || r.miniSummary || '',
            }))
        };

        // ─── AUTO-REFINEMENT LOOP ───
        const AUTO_REFINE_THRESHOLD = 50;
        const MAX_AUTO_REFINE_ATTEMPTS = 2;
        let currentAttemptKeywords = keywords;
        let currentAttemptFilters = filters;

        for (let attempt = 0; attempt < MAX_AUTO_REFINE_ATTEMPTS; attempt++) {
            const topScore = rankResult.rankings?.[0]?.score || 0;
            if (topScore >= AUTO_REFINE_THRESHOLD) break;

            send({ step: 'auto_refine', message: `Top result scored ${topScore}/100 — automatically refining search (attempt ${attempt + 1}/${MAX_AUTO_REFINE_ATTEMPTS})...` });
            console.log(`\n🔄 AUTO-REFINE attempt ${attempt + 1}: top score ${topScore} < ${AUTO_REFINE_THRESHOLD}`);

            try {
                const refinement = await autoRefine(context, currentAttemptKeywords, currentAttemptFilters, rankResult.rankings?.slice(0, 3) || [], model);
                console.log(`   Refined keywords: ${refinement.newKeywords}`);
                console.log(`   Refined filters: ${JSON.stringify(refinement.newFilters)}`);

                send({ step: 'auto_refine', message: `🤖 ${refinement.refinementReason}` });

                currentAttemptKeywords = refinement.newKeywords;
                currentAttemptFilters = refinement.newFilters || {};

                // Rebuild API filter
                const refinedApiFilter = {};
                if (currentAttemptFilters.module && Array.isArray(currentAttemptFilters.module)) {
                    const mapped = currentAttemptFilters.module.map(m => MODULE_IDS[m]).filter(Boolean);
                    if (mapped.length > 0) refinedApiFilter.categoryList = mapped;
                }
                if (currentAttemptFilters.court && Array.isArray(currentAttemptFilters.court)) {
                    const mapped = currentAttemptFilters.court.map(c => COURT_IDS[c]).filter(Boolean);
                    if (mapped.length > 0) refinedApiFilter.courtList = mapped;
                }
                refinedApiFilter.groupList = [DOCTYPE_IDS['Case Laws']];

                // Re-search
                send({ step: 'search', message: `Re-searching with refined keywords: "${currentAttemptKeywords}"...` });
                const refinedSearch = await doSearch(refinedApiFilter, currentAttemptKeywords);
                const refinedCases = refinedSearch.results.slice(0, count);

                if (refinedCases.length === 0) {
                    send({ step: 'auto_refine', message: `Refined search returned 0 results — keeping previous results.` });
                    break;
                }

                send({ step: 'search_done', message: `Refined search found ${refinedSearch.totalCount} results. Scoring top ${refinedCases.length}...`, totalCount: refinedSearch.totalCount, total: refinedCases.length });

                // Parallel fetch+score for refined cases
                const refinedScoredResults = [];
                let refinedCompleted = 0;

                for (let i = 0; i < refinedCases.length; i += CONCURRENCY) {
                    const batch = refinedCases.slice(i, i + CONCURRENCY);
                    const results = await Promise.allSettled(batch.map(async (caseInfo) => {
                        const caseText = await fetchCaseText(caseInfo);
                        if (!caseText) return null;
                        const scoreResult = await scoreFromFullText(context, caseText.text, caseText.id, model);
                        refinedCompleted++;
                        send({ step: 'score_progress', message: `⚡ Refined: scored ${refinedCompleted}/${refinedCases.length}`, progress: refinedCompleted, total: refinedCases.length });
                        return { ...caseText, score: scoreResult.score, category: scoreResult.category, reason: scoreResult.reason, miniSummary: scoreResult.miniSummary, analysis: scoreResult.analysis };
                    }));
                    for (const r of results) {
                        if (r.status === 'fulfilled' && r.value) refinedScoredResults.push(r.value);
                    }
                    if (i + CONCURRENCY < refinedCases.length) await new Promise(r => setTimeout(r, 500));
                }

                if (refinedScoredResults.length === 0) {
                    send({ step: 'auto_refine', message: `Could not score refined results — keeping previous results.` });
                    break;
                }

                refinedScoredResults.sort((a, b) => (b.score || 0) - (a.score || 0));

                // Generate summaries for top 5 refined
                const topRefined = refinedScoredResults.slice(0, TOP_N_SUMMARIES);
                await Promise.allSettled(topRefined.map(async (c) => {
                    try {
                        c.summary = await summarizeCase(c.text, c.filename, currentAttemptKeywords, context, summaryPrompt, model);
                    } catch { c.summary = c.miniSummary || ''; }
                }));

                rankResult = {
                    rankings: refinedScoredResults.map(r => ({
                        id: r.id, filename: r.filename, heading: r.heading, court: r.court, date: r.date,
                        score: r.score, category: r.category, reason: r.reason,
                        summary: r.summary || r.miniSummary || '',
                    }))
                };

            } catch (err) {
                console.error(`Auto-refine attempt ${attempt + 1} failed:`, err.message);
                send({ step: 'auto_refine', message: `Auto-refinement failed: ${err.message}. Keeping current results.` });
                break;
            }
        }

        // Store for follow-up chat
        chatHistory = [];
        chatHistory.push({ role: 'user', content: context });
        chatHistory.push({ role: 'assistant', content: JSON.stringify(rankResult) });
        analyzedCases = scoredResults;

        send({ step: 'done', message: 'Analysis complete!', data: rankResult, totalAnalyzed: scoredResults.length });
        res.end();
    } catch (err) {
        console.error('Analyze error:', err.message);
        res.write(JSON.stringify({ step: 'error', message: err.message }) + '\n');
        res.end();
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

app.listen(PORT, () => {
    console.log(`\n🚀 WorkflowIQ Casebot running at http://localhost:${PORT}\n`);
});
