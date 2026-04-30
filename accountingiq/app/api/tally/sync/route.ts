// POST /api/tally/sync
// Body: { bridgeId, period: { start, end }, kinds?: ReportKind[] }
// Pulls each requested report from the user's Tally via the bridge and
// returns the raw XML keyed by FileKey. The browser then feeds that XML
// into the existing parser pipeline (lib/parser.ts) without modification.

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { getSessionForUser, toClientSession } from '@/lib/connectors/session-store';
import { getConnector } from '@/lib/connectors/registry';
import type { ReportKind, ReportPeriod } from '@/lib/connectors/types';

const DEFAULT_KINDS: ReportKind[] = ['master', 'trialbal', 'pandl', 'bsheet', 'grpsum', 'daybook'];

function isReportKind(s: string): s is ReportKind {
  return DEFAULT_KINDS.includes(s as ReportKind);
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

  const session = getSessionForUser(userId, bridgeId);
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
      results[kind] = { ok: true, xml: r.xml };
    } catch (err) {
      results[kind] = { ok: false, error: (err as Error).message };
    }
  }

  return NextResponse.json({ company: session.selectedCompany.name, period, results });
}
