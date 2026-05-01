// POST /api/tally/bridge-result
// Bridge submits the job result. Auth: Bearer <bridgeToken>.
// Body: { jobId, xml?, error? }

import { NextResponse } from 'next/server';
import { authenticateBridge } from '@/lib/connectors/session-store';
import { deliverResult } from '@/lib/connectors/bridge-bus';
import { bearerToken } from '@/lib/connectors/auth';

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  const session = await authenticateBridge(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { jobId?: string; xml?: string; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  // Diagnostic: surface size + first chars so we can correlate with the bridge
  // console when debugging "all amounts ₹0" reports.
  const xmlLen = (body.xml ?? '').length;
  const preview = (body.xml ?? '').slice(0, 200).replace(/\s+/g, ' ');
  console.log(`[bridge-result] jobId=${body.jobId} bridgeId=${session.bridgeId} len=${xmlLen} error=${body.error ?? '-'} first200=${preview}`);

  const ok = deliverResult(session.bridgeId, body.jobId, body.xml ?? '', body.error);
  if (!ok) return NextResponse.json({ error: 'Unknown jobId' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
