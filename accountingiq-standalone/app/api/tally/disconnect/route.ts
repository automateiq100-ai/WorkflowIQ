// POST /api/tally/disconnect  → tear down the user's paired bridge session.

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { getSessionForUser, disconnectBridge } from '@/lib/connectors/session-store';
import { dropBridge } from '@/lib/connectors/bridge-bus';

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const bridgeId = body.bridgeId as string | undefined;
  if (!bridgeId) return NextResponse.json({ error: 'Missing bridgeId' }, { status: 400 });
  const s = await getSessionForUser(userId, bridgeId);
  if (!s) return NextResponse.json({ ok: true }); // already gone
  dropBridge(bridgeId);
  await disconnectBridge(bridgeId);
  return NextResponse.json({ ok: true });
}
