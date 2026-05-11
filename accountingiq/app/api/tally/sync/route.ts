// POST /api/tally/sync
// Body: { bridgeId, period: { start, end }, kinds?: ReportKind[] }
// Pulls each requested report from the user's Tally via the bridge and
// returns the raw XML keyed by FileKey. The browser then feeds that XML
// into the existing parser pipeline (lib/parser.ts) without modification.

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { getSessionForUser, toClientSession } from '@/lib/connectors/session-store';
import { getConnector } from '@/lib/connectors/registry';
import { detectTallyError } from '@/lib/connectors/tally/detect-error';
import type { ReportKind, ReportPeriod } from '@/lib/connectors/types';

// All known reports — required + conditional + optional. Sync attempts each one
// and returns per-kind ok/error so a missing optional report doesn't fail the run.
const DEFAULT_KINDS: ReportKind[] = [
  'master', 'trialbal', 'pandl', 'bsheet', 'grpsum', 'daybook',
  'sales', 'purchase', 'bills', 'payables', 'cashflow',
  'faregister', 'stock', 'bankrecon',
];

function isReportKind(s: string): s is ReportKind {
  return DEFAULT_KINDS.includes(s as ReportKind);
}

// ── Last-XML-per-kind ring (diagnostic) ───────────────────────────────────
// Pinned to globalThis so it survives Next.js HMR and so the new
// /api/tally/sync/debug route reads from the SAME map this route writes to,
// even when bundled separately. Mirrors the bridge-bus.ts singleton pattern.
export interface LastSyncEntry {
  xml: string;
  fetchedAt: number;
  sizeBytes: number;
  ok: boolean;
  error?: string;
}
type LastSyncStore = Map<string, Map<ReportKind, LastSyncEntry>>;
const LAST_SYNC: LastSyncStore =
  ((globalThis as unknown as { __aiq_last_sync?: LastSyncStore }).__aiq_last_sync ??=
    new Map());

function lastSyncKey(userId: string, bridgeId: string): string {
  return `${userId}::${bridgeId}`;
}

export function recordLastSync(userId: string, bridgeId: string, kind: ReportKind, entry: LastSyncEntry): void {
  const key = lastSyncKey(userId, bridgeId);
  let m = LAST_SYNC.get(key);
  if (!m) { m = new Map(); LAST_SYNC.set(key, m); }
  m.set(kind, entry);
}

export function readLastSync(userId: string, bridgeId: string): Map<ReportKind, LastSyncEntry> | undefined {
  return LAST_SYNC.get(lastSyncKey(userId, bridgeId));
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const bridgeId = body.bridgeId as string | undefined;
  const period = body.period as ReportPeriod | undefined;
  const kinds: ReportKind[] = Array.isArray(body.kinds)
    ? body.kinds.filter((k: unknown): k is ReportKind => typeof k === 'string' && isReportKind(k))
    : DEFAULT_KINDS;

  if (!bridgeId || !period?.start || !period?.end) {
    return NextResponse.json({ error: 'Missing bridgeId or period' }, { status: 400 });
  }

  const session = await getSessionForUser(userId, bridgeId);
  if (!session) return NextResponse.json({ error: 'No bridge session' }, { status: 404 });
  if (!session.selectedCompany) return NextResponse.json({ error: 'No company selected' }, { status: 400 });

  const connector = getConnector('tally');
  const clientSession = toClientSession(session);

  const results: Record<string, { ok: true; xml: string } | { ok: false; error: string }> = {};
  // Fetch sequentially — Tally's XML server is single-threaded per request and
  // running 6 concurrent exports against the user's desktop hammers them.
  for (const kind of kinds) {
    try {
      const r = await connector.fetchReport(clientSession, kind, period);
      // Tally returns 200 OK with an error envelope inside the XML when a
      // report name is unknown (e.g. "Fixed Assets Register" doesn't exist
      // in a vanilla company). Without this check those envelopes would
      // count as loaded files downstream and the dashboard would say
      // "14 of 14" even when 2 are garbage.
      const tallyErr = detectTallyError(r.xml);
      if (tallyErr) {
        results[kind] = { ok: false, error: tallyErr };
        recordLastSync(userId, bridgeId, kind, {
          xml: r.xml,
          fetchedAt: Date.now(),
          sizeBytes: r.xml.length,
          ok: false,
          error: tallyErr,
        });
        console.log(`[tally-sync] ${kind} REJECT ${tallyErr}`);
        continue;
      }
      results[kind] = { ok: true, xml: r.xml };
      recordLastSync(userId, bridgeId, kind, {
        xml: r.xml,
        fetchedAt: Date.now(),
        sizeBytes: r.xml.length,
        ok: true,
      });
      console.log(`[tally-sync] ${kind} ok len=${r.xml.length} period=${period.start}..${period.end}`);
    } catch (err) {
      const msg = (err as Error).message;
      results[kind] = { ok: false, error: msg };
      recordLastSync(userId, bridgeId, kind, {
        xml: '',
        fetchedAt: Date.now(),
        sizeBytes: 0,
        ok: false,
        error: msg,
      });
      console.log(`[tally-sync] ${kind} ERR ${msg}`);
    }
  }

  return NextResponse.json({ company: session.selectedCompany.name, period, results });
}
