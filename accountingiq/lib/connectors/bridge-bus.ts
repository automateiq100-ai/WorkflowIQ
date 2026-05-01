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
const JOB_TIMEOUT_MS = 60_000;

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

export function dispatchJob(bridgeId: string, job: BridgeJob): Promise<string> {
  const q = ensure(bridgeId);
  return new Promise<string>((resolve, reject) => {
    const pending: PendingJob = { id: newJobId(), job, resolve, reject, enqueuedAt: Date.now() };

    const timer = setTimeout(() => {
      q.inflight.delete(pending.id);
      q.pending = q.pending.filter((p) => p.id !== pending.id);
      reject(new Error('Bridge job timed out'));
    }, JOB_TIMEOUT_MS);

    const wrappedResolve = (xml: string) => { clearTimeout(timer); resolve(xml); };
    const wrappedReject = (err: Error) => { clearTimeout(timer); reject(err); };
    pending.resolve = wrappedResolve;
    pending.reject = wrappedReject;

    // Hand directly to a waiting poller if any, else queue.
    const poller = q.pollers.shift();
    if (poller) {
      q.inflight.set(pending.id, pending);
      poller(pending);
    } else {
      q.pending.push(pending);
    }
  });
}

// Bridge calls this; resolves with the next job (or null after `waitMs`).
export function pollNextJob(bridgeId: string, waitMs = 25_000): Promise<{ id: string; job: BridgeJob } | null> {
  const q = ensure(bridgeId);
  const next = q.pending.shift();
  if (next) {
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
