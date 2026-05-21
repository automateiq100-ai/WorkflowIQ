// GET /api/tally/active-session
// Returns the signed-in user's most-recently-active bridge session, if any.
// Lets the Tally Connection page auto-resume an already-paired bridge after
// the browser's sessionStorage was cleared (or a new tab/device).

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { getActiveSessionForUser, toClientSession } from '@/lib/connectors/session-store';

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rec = await getActiveSessionForUser(userId);
  if (!rec) return NextResponse.json({ session: null });
  return NextResponse.json({ session: toClientSession(rec) });
}
