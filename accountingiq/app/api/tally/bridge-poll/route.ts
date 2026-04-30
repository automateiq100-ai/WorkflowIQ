// GET /api/tally/bridge-poll
// Bridge long-polls here for the next job. Auth: Bearer <bridgeToken>.
// Returns { id, payload } when a job is available, or { id: null } after timeout.

import { NextResponse } from 'next/server';
import { authenticateBridge } from '@/lib/connectors/session-store';
import { pollNextJob } from '@/lib/connectors/bridge-bus';
import { bearerToken } from '@/lib/connectors/auth';

export async function GET(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  const session = authenticateBridge(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const next = await pollNextJob(session.bridgeId, 25_000);
  if (!next) return NextResponse.json({ id: null });
  return NextResponse.json({ id: next.id, kind: next.job.kind, payload: next.job.payload });
}
