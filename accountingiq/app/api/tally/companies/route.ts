// GET /api/tally/companies?bridgeId=...
// Lists companies present in the user's paired Tally instance.
// PUT body { bridgeId, companyName } selects one for subsequent reads/writes.

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { getSessionForUser, setSessionCompany, toClientSession } from '@/lib/connectors/session-store';
import { getConnector } from '@/lib/connectors/registry';

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const bridgeId = new URL(req.url).searchParams.get('bridgeId');
  if (!bridgeId) return NextResponse.json({ error: 'Missing bridgeId' }, { status: 400 });
  const session = await getSessionForUser(userId, bridgeId);
  if (!session) return NextResponse.json({ error: 'No bridge session' }, { status: 404 });
  try {
    const companies = await getConnector('tally').listCompanies(toClientSession(session));
    return NextResponse.json({ companies });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const bridgeId = body.bridgeId as string | undefined;
  const companyName = body.companyName as string | undefined;
  if (!bridgeId || !companyName) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const session = await getSessionForUser(userId, bridgeId);
  if (!session) return NextResponse.json({ error: 'No bridge session' }, { status: 404 });
  await setSessionCompany(bridgeId, { id: companyName, name: companyName });
  return NextResponse.json({ ok: true });
}
