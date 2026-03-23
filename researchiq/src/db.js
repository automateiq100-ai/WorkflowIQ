const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const HTML_DIR = path.join(CACHE_DIR, 'html');
const META_DIR = path.join(CACHE_DIR, 'meta');

// Ensure cache directories exist
fs.mkdirSync(HTML_DIR, { recursive: true });
fs.mkdirSync(META_DIR, { recursive: true });

function metaPath(id) { return path.join(META_DIR, `${id}.json`); }
function htmlPath(id) { return path.join(HTML_DIR, `${id}.html`); }

// ─────────────────────────────────────────────
//  Case Records (plain text + metadata)
// ─────────────────────────────────────────────

async function getCaseRecord(id) {
    try {
        const raw = await fsPromises.readFile(metaPath(id), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function saveCaseRecord(obj) {
    try {
        await fsPromises.writeFile(metaPath(obj.id), JSON.stringify({ ...obj, fetched_at: new Date().toISOString() }), 'utf8');
    } catch (err) {
        console.error(`[cache] saveCaseRecord error for ${obj.id}:`, err.message);
    }
}

// ─────────────────────────────────────────────
//  Headnote Storage
// ─────────────────────────────────────────────

async function saveHeadnoteRecord(obj) {
    try {
        // Preserve plain_text if the record already exists (headnote update should not overwrite full text)
        let existing = null;
        try { existing = JSON.parse(await fsPromises.readFile(metaPath(obj.id), 'utf8')); } catch { /* not found */ }
        const merged = {
            ...(existing || {}),
            id: obj.id,
            heading: obj.heading || null,
            court: obj.court || null,
            judgement_date: obj.date || null,
            citation: obj.citation || null,
            short_content: obj.shortContent || null,
            in_favour_of: obj.infavourOf || null,
            category: obj.category || null,
            group_name: obj.groupName || null,
            parties: obj.parties || null,
            act: obj.act || null,
            raw: obj.raw ? JSON.stringify(obj.raw) : null,
            headnote_fetched_at: new Date().toISOString()
        };
        await fsPromises.writeFile(metaPath(obj.id), JSON.stringify(merged), 'utf8');
    } catch (err) {
        console.error(`[cache] saveHeadnoteRecord error for ${obj.id}:`, err.message);
    }
}

async function getHeadnotesByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const results = await Promise.all(ids.map(async (id) => {
        try {
            const raw = await fsPromises.readFile(metaPath(id), 'utf8');
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }));
    return results.filter(r => r && r.short_content);
}

// ─────────────────────────────────────────────
//  HTML Storage (local file cache)
// ─────────────────────────────────────────────

async function getHtmlFromStorage(id) {
    try {
        return await fsPromises.readFile(htmlPath(id), 'utf8');
    } catch {
        return null;
    }
}

async function saveHtmlToStorage(id, html) {
    try {
        await fsPromises.writeFile(htmlPath(id), html, 'utf8');
    } catch (err) {
        console.error(`[cache] saveHtmlToStorage error for ${id}:`, err.message);
    }
}

module.exports = {
    getCaseRecord,
    saveCaseRecord,
    getHeadnotesByIds,
    saveHeadnoteRecord,
    getHtmlFromStorage,
    saveHtmlToStorage
};
