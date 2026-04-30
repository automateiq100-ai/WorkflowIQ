// POST  /api/tally/pair      → issue a fresh pairing code for the signed-in user
// GET   /api/tally/pair?code=ABC123  → poll: returns the ConnectorSession once a bridge has claimed the code

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { createPairingCode, consumePairingResult } from '@/lib/connectors/session-store';

export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const code = createPairingCode(userId);
  return NextResponse.json({ code, expiresInSec: 300 });
}

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return NextResponse.json({ error: 'Missing code' }, { status: 400 });
  const session = consumePairingResult(code, userId);
  if (!session) return NextResponse.json({ paired: false });
  return NextResponse.json({ paired: true, session });
}
