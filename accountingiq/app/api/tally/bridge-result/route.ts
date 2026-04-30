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
  const session = authenticateBridge(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { jobId?: string; xml?: string; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  const ok = deliverResult(session.bridgeId, body.jobId, body.xml ?? '', body.error);
  if (!ok) return NextResponse.json({ error: 'Unknown jobId' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
