// Long-poll loop: pull next job from cloud, hand to Tally, post result back.

import { postToTally } from './tally.mjs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(zlib.gzip);

const POLL_TIMEOUT_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;

export class UnauthorizedError extends Error {
  constructor() { super('HTTP 401'); this.name = 'UnauthorizedError'; }
}

export async function runRelay({ cloudUrl, bridgeToken, onLog }) {
  const log = onLog ?? ((m) => console.log(`[bridge] ${m}`));

  for (;;) {
    try {
      const job = await pollNext(cloudUrl, bridgeToken);
      if (!job || job.id === null) continue;
      log(`job ${job.id} (${job.kind})`);
      try {
        const xml = await postToTally(job.payload);
        log(`job ${job.id} → tally returned ${xml.length} chars`);
        await postResult(cloudUrl, bridgeToken, { jobId: job.id, xml });
      } catch (err) {
        log(`job ${job.id} → tally error: ${err.message}`);
        await postResult(cloudUrl, bridgeToken, { jobId: job.id, error: err.message });
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) throw err; // bubble up — caller decides
      log(`poll error: ${err.message}; retrying in ${RECONNECT_DELAY_MS}ms`);
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}

async function pollNext(cloudUrl, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), POLL_TIMEOUT_MS + 5_000);
  try {
    const r = await fetch(`${cloudUrl}/api/tally/bridge-poll`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    if (r.status === 401) throw new UnauthorizedError();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function postResult(cloudUrl, token, body) {
  // Ship the report XML as the RAW request body with jobId/error in the query
  // string, GZIP-compressed.  JSON-wrapping a multi-MB report (All Masters,
  // Day Book) inflated it ~30% via escaping and forced a giant JSON.parse on
  // the cloud — which returned HTTP 400 on the heaviest reports.  Tally XML is
  // extremely repetitive, so gzip shrinks it ~10:1: a 5 MB report goes out as
  // ~500 KB, well under anything that was failing, and transfers faster.
  const params = new URLSearchParams({ jobId: body.jobId });
  if (body.error) params.set('error', String(body.error).slice(0, 500));

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/xml; charset=utf-8',
  };
  let payload = '';
  if (!body.error && body.xml) {
    payload = await gzipAsync(Buffer.from(body.xml, 'utf8'));
    headers['Content-Encoding'] = 'gzip';
  }

  const r = await fetch(`${cloudUrl}/api/tally/bridge-result?${params.toString()}`, {
    method: 'POST',
    headers,
    body: payload,
  });
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(`bridge-result HTTP ${r.status}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
