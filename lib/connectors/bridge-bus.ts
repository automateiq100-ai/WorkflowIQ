// In-process job bus between the cloud's connector layer and the user's local
// bridge agent. The bridge holds a long-poll on /api/tally/bridge-poll and
// posts results to /api/tally/bridge-result.
//
// v1: in-memory map keyed by bridgeId. Single Next.js instance only — move to
// Redis pub/sub when we scale beyond one server.

export interface BridgeJob {
  kind: 'tally-xml';
  payload: string;     // raw XML to POST to localhost:9000
}

interface PendingJob {
  id: string;
  job: BridgeJob;
  resolve: (xml: string) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  pickupTimer?: ReturnType<typeof setTimeout>;
  execTimer?: ReturnType<typeof setTimeout>;
}

interface BridgeQueue {
  pending: PendingJob[];                      // not yet picked up
  inflight: Map<string, PendingJob>;          // picked up, awaiting result
  pollers: Array<(j: PendingJob | null) => void>;
}

// Pin to globalThis so the same Map instance is shared across all route
// bundles and survives Turbopack/HMR module re-evaluations. Without this,
// dispatchJob (called from /api/tally/companies, /sync, /post-voucher) and
// pollNextJob (/api/tally/bridge-poll) end up writing to and reading from
// different Map instances and the bridge never sees the job → 60s timeout.
const QUEUES: Map<string, BridgeQueue> =
  ((globalThis as unknown as { __aiq_bridge_queues?: Map<string, BridgeQueue> }).__aiq_bridge_queues ??=
    new Map<string, BridgeQueue>());

// Two-phase timeout.  The original single 60s budget conflated "the bridge
// never picked this up" (offline/disconnected) with "Tally is taking a long
// time to generate a big report" — and 60s is far too short for the heavy
// reports (master = full chart of accounts, daybook = every voucher,
// bills/payables = bill-by-bill).  Those legitimately need a few minutes.
//
//   • PICKUP  — how long we wait for the bridge to dequeue the job.  If the
//     bridge is running it grabs jobs within milliseconds (it long-polls), so
//     30s is generous; exceeding it means the bridge is offline.
//   • EXEC    — how long Tally gets to actually produce the report once the
//     bridge has picked it up.  Starts ONLY at pickup, so a job that waits
//     behind earlier ones in the queue doesn't burn its clock while idle.
//
// Both are overridable via env so a user on a slow machine / huge company can
// extend them without a code change.
const PICKUP_TIMEOUT_MS = parseInt(process.env.BRIDGE_PICKUP_TIMEOUT_MS ?? '30000', 10);
const EXEC_TIMEOUT_MS = parseInt(process.env.BRIDGE_EXEC_TIMEOUT_MS ?? '180000', 10);

function ensure(bridgeId: string): BridgeQueue {
  let q = QUEUES.get(bridgeId);
  if (!q) {
    q = { pending: [], inflight: new Map(), pollers: [] };
    QUEUES.set(bridgeId, q);
  }
  return q;
}

function newJobId(): string {
  return `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Start the execution timer once the bridge has actually picked the job up.
 *  Clears the pickup deadline.  Called from both pickup paths: a direct
 *  hand-off in dispatchJob (a poller was already waiting) and a dequeue in
 *  pollNextJob (the bridge polled after the job was queued). */
function startExec(p: PendingJob): void {
  if (p.pickupTimer) { clearTimeout(p.pickupTimer); p.pickupTimer = undefined; }
  if (p.execTimer) return; // already running — don't restart on a re-poll
  p.execTimer = setTimeout(() => {
    p.reject(new Error(
      `Bridge job timed out — Tally took longer than ${Math.round(EXEC_TIMEOUT_MS / 1000)}s to `
      + 'generate this report. Large reports (All Masters, Day Book) can be slow; '
      + 'set BRIDGE_EXEC_TIMEOUT_MS higher or pull a shorter period.',
    ));
  }, EXEC_TIMEOUT_MS);
}

export function dispatchJob(bridgeId: string, job: BridgeJob): Promise<string> {
  const q = ensure(bridgeId);
  return new Promise<string>((resolve, reject) => {
    const pending: PendingJob = { id: newJobId(), job, resolve, reject, enqueuedAt: Date.now() };

    // cleanup runs on EITHER success or failure: tear down both timers and
    // make sure the job isn't lingering in any queue.
    const cleanup = () => {
      if (pending.pickupTimer) clearTimeout(pending.pickupTimer);
      if (pending.execTimer) clearTimeout(pending.execTimer);
      q.inflight.delete(pending.id);
      q.pending = q.pending.filter((p) => p.id !== pending.id);
    };
    pending.resolve = (xml: string) => { cleanup(); resolve(xml); };
    pending.reject = (err: Error) => { cleanup(); reject(err); };

    // Phase 1: the bridge must dequeue this within PICKUP_TIMEOUT_MS, else
    // it's almost certainly offline.
    pending.pickupTimer = setTimeout(() => {
      pending.reject(new Error(
        `Tally bridge did not pick up the job within ${Math.round(PICKUP_TIMEOUT_MS / 1000)}s — `
        + 'is the AccountingIQ bridge running and connected?',
      ));
    }, PICKUP_TIMEOUT_MS);

    // Hand directly to a waiting poller if any, else queue.
    const poller = q.pollers.shift();
    if (poller) {
      startExec(pending);                 // phase 2 begins now (picked up)
      q.inflight.set(pending.id, pending);
      poller(pending);
    } else {
      q.pending.push(pending);            // still phase 1 (awaiting pickup)
    }
  });
}

// Bridge calls this; resolves with the next job (or null after `waitMs`).
export function pollNextJob(bridgeId: string, waitMs = 25_000): Promise<{ id: string; job: BridgeJob } | null> {
  const q = ensure(bridgeId);
  const next = q.pending.shift();
  if (next) {
    startExec(next);                      // picked up from the queue → phase 2
    q.inflight.set(next.id, next);
    return Promise.resolve({ id: next.id, job: next.job });
  }
  return new Promise((resolve) => {
    let done = false;
    const cb = (p: PendingJob | null) => {
      if (done) return;
      done = true;
      resolve(p ? { id: p.id, job: p.job } : null);
    };
    q.pollers.push(cb);
    setTimeout(() => {
      const idx = q.pollers.indexOf(cb);
      if (idx >= 0) q.pollers.splice(idx, 1);
      cb(null);
    }, waitMs);
  });
}

export function deliverResult(bridgeId: string, jobId: string, xml: string, error?: string): boolean {
  const q = QUEUES.get(bridgeId);
  if (!q) return false;
  const p = q.inflight.get(jobId);
  if (!p) return false;
  q.inflight.delete(jobId);
  if (error) p.reject(new Error(error));
  else p.resolve(xml);
  return true;
}

export function dropBridge(bridgeId: string): void {
  const q = QUEUES.get(bridgeId);
  if (!q) return;
  for (const p of q.inflight.values()) p.reject(new Error('Bridge disconnected'));
  for (const p of q.pending) p.reject(new Error('Bridge disconnected'));
  for (const cb of q.pollers) cb(null);
  QUEUES.delete(bridgeId);
}
