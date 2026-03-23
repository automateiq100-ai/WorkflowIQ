/**
 * populate-db.js
 *
 * Populates the Supabase DB with GST Case Laws from years 2025 and 2026.
 * Fetches case HTML from Centax, stores it in Supabase Storage, and saves
 * metadata to the cases table.
 *
 * Usage:
 *   node scripts/populate-db.js                  # fetch + store only
 *   node scripts/populate-db.js --summarize       # also generate AI summaries
 *   node scripts/populate-db.js --embed           # also generate embeddings
 *   node scripts/populate-db.js --summarize --embed
 *   node scripts/populate-db.js --year 2025       # single year
 *   node scripts/populate-db.js --dry-run         # list cases without saving
 */

require('dotenv').config();
const { searchCases } = require('../src/search');
const { getCaseHTML } = require('../src/download');
const { getCaseRecord, saveCaseRecord, saveHtmlToStorage, saveSummary, embedCase } = require('../src/db');
const { summarizeCase } = require('../src/analyzer');

// ── Config ──────────────────────────────────────────────────────────────────

const GST_MODULE_ID = '111050000000018400';
const CASE_LAWS_GROUP_ID = '111050000000000060';

const PAGE_SIZE = 20;
const DELAY_BETWEEN_CASES_MS = 300;
const DELAY_BETWEEN_PAGES_MS = 1000;
const MAX_RETRIES = 3;

const args = process.argv.slice(2);
const DO_SUMMARIZE = args.includes('--summarize');
const DO_EMBED = args.includes('--embed');
const DRY_RUN = args.includes('--dry-run');
const YEAR_ARG = (() => {
    const idx = args.indexOf('--year');
    return idx !== -1 ? args[idx + 1] : null;
})();

const YEARS = YEAR_ARG ? [YEAR_ARG] : ['2026', '2025'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function extractJudgementDate(text) {
    const patterns = [
        /decided\s+on[:\s]+(\d{1,2}[\s\-\/]\w+[\s\-\/]\d{4})/i,
        /date\s+of\s+decision[:\s]+(\d{1,2}[\s\-\/]\w+[\s\-\/]\d{4})/i,
        /pronounced\s+on[:\s]+(\d{1,2}[\s,\s]\w+[,\s]+\d{4})/i,
        /order\s+dated[:\s]+(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4})/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) return m[1].trim();
    }
    return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function processCase(caseInfo, stats) {
    const { id, heading, court } = caseInfo;

    // Skip if already in DB
    const existing = await getCaseRecord(id);
    if (existing) {
        stats.skipped++;
        process.stdout.write('s');
        return;
    }

    if (DRY_RUN) {
        console.log(`  [DRY] Would fetch: ${heading || id}`);
        stats.fetched++;
        return;
    }

    let html = null;
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            const doc = await getCaseHTML(id);
            html = doc.htmlContent;
            break;
        } catch (err) {
            retries++;
            if (retries < MAX_RETRIES) {
                await sleep(Math.min(3000 * Math.pow(2, retries), 15000));
            } else {
                console.error(`\n  ✗ Failed ${id}: ${err.message}`);
                stats.failed++;
                return;
            }
        }
    }

    const plainText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const judgementDate = extractJudgementDate(plainText);

    // Save HTML to Storage (fire and wait)
    await saveHtmlToStorage(id, html).catch(err =>
        console.error(`\n  ⚠ Storage error ${id}: ${err.message}`)
    );

    // Save case record to DB
    await saveCaseRecord({
        id,
        heading,
        court,
        judgement_date: judgementDate,
        plain_text: plainText
    });

    stats.fetched++;
    process.stdout.write('.');

    // Optionally generate summary
    if (DO_SUMMARIZE) {
        try {
            const summary = await summarizeCase(plainText, heading, '', '', null, null);
            if (summary) {
                await saveSummary(id, summary);
                stats.summarized++;
                process.stdout.write('S');
            }
        } catch (err) {
            console.error(`\n  ⚠ Summarize error ${id}: ${err.message}`);
        }
    }

    // Optionally generate embedding
    if (DO_EMBED) {
        try {
            // Use summary if available, else first 8K of plain text
            const textToEmbed = (DO_SUMMARIZE ? '' : '') || plainText.substring(0, 8000);
            await embedCase(id, textToEmbed);
            stats.embedded++;
            process.stdout.write('E');
        } catch (err) {
            console.error(`\n  ⚠ Embed error ${id}: ${err.message}`);
        }
    }
}

async function populateYear(year, stats) {
    console.log(`\n📅 Year: ${year}`);

    let page = 1;
    let totalCount = 0;

    do {
        const result = await searchCases('', {
            page,
            pageSize: PAGE_SIZE,
            sortby: 'date',
            sortorder: '0', // newest first
            filter: {
                categoryList: [GST_MODULE_ID],
                groupList: [CASE_LAWS_GROUP_ID],
                yearList: [year]
            },
            isAdvSearch: false
        });

        totalCount = result.totalCount;
        const cases = result.results;

        if (page === 1) {
            console.log(`  Found ${totalCount} cases for ${year}. Processing...`);
        }

        process.stdout.write(`  Page ${page}/${Math.ceil(totalCount / PAGE_SIZE)}: `);

        for (const caseInfo of cases) {
            await processCase(caseInfo, stats);
            await sleep(DELAY_BETWEEN_CASES_MS);
        }

        console.log(''); // newline after progress dots
        page++;

        if (cases.length < PAGE_SIZE || cases.length === 0) break;
        await sleep(DELAY_BETWEEN_PAGES_MS);

    } while (page <= Math.ceil(totalCount / PAGE_SIZE));
}

async function main() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  Centax GST DB Populator');
    console.log(`  Years: ${YEARS.join(', ')}`);
    console.log(`  Options: summarize=${DO_SUMMARIZE}, embed=${DO_EMBED}, dry-run=${DRY_RUN}`);
    console.log('═══════════════════════════════════════════════════');
    console.log('Legend: . = fetched  s = skipped (exists)  ✗ = failed  S = summarized  E = embedded');

    const stats = { fetched: 0, skipped: 0, failed: 0, summarized: 0, embedded: 0 };
    const startTime = Date.now();

    for (const year of YEARS) {
        await populateYear(year, stats);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Done in ${elapsed}s`);
    console.log(`  Fetched:    ${stats.fetched}`);
    console.log(`  Skipped:    ${stats.skipped} (already in DB)`);
    console.log(`  Failed:     ${stats.failed}`);
    if (DO_SUMMARIZE) console.log(`  Summarized: ${stats.summarized}`);
    if (DO_EMBED)     console.log(`  Embedded:   ${stats.embedded}`);
    console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
