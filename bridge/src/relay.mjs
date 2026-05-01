// Long-poll loop: pull next job from cloud, hand to Tally, post result back.

import { postToTally } from './tally.mjs';

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
  const r = await fetch(`${cloudUrl}/api/tally/bridge-result`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(`bridge-result HTTP ${r.status}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
