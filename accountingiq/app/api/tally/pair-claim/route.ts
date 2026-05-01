// POST /api/tally/pair-claim
// Called by the local bridge agent. Body: { code: "ABC123" }.
// Returns: { bridgeId, bridgeToken } — bridge then long-polls /bridge-poll
// using bridgeToken as a Bearer credential.

import { NextResponse } from 'next/server';
import { claimPairingCode } from '@/lib/connectors/session-store';

export async function POST(req: Request) {
  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const code = (body.code ?? '').trim();
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  const claimed = await claimPairingCode(code);
  if (!claimed) return NextResponse.json({ error: 'Invalid or expired code' }, { status: 410 });
  return NextResponse.json({ bridgeId: claimed.bridgeId, bridgeToken: claimed.bridgeToken });
}
