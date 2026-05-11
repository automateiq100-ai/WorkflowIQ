// GET /api/tally/sync/debug?bridgeId=...
// Returns diagnostic snapshot of the last sync per kind so the user can
// inspect what XML Tally actually returned without re-syncing or scrolling
// server logs. Default response is a 1000-char snippet per kind; pass
// ?full=1 to download the full XML for one kind (also requires &kind=...).
//
// Used by the "Debug Sync" panel in TallyConnectionView.

import { NextResponse } from 'next/server';
import { getUserId } from '@/lib/connectors/auth';
import { readLastSync } from '../route';
import { detectTallyError } from '@/lib/connectors/tally/detect-error';

const PREVIEW_CHARS = 1000;

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const bridgeId = url.searchParams.get('bridgeId');
  const full = url.searchParams.get('full') === '1';
  const kindParam = url.searchParams.get('kind');
  if (!bridgeId) return NextResponse.json({ error: 'Missing bridgeId' }, { status: 400 });

  const store = readLastSync(userId, bridgeId);
  if (!store) {
    return NextResponse.json({ kinds: {}, message: 'No sync recorded yet for this bridge.' });
  }

  // Full-XML download for a single kind
  if (full && kindParam) {
    const entry = store.get(kindParam as never);
    if (!entry) return NextResponse.json({ error: 'No data for that kind' }, { status: 404 });
    return new NextResponse(entry.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="tally-${kindParam}.xml"`,
      },
    });
  }

  // Snippet view per kind
  const kinds: Record<string, {
    sizeBytes: number;
    fetchedAt: number;
    ok: boolean;
    error?: string;
    firstChars: string;
    tallyError: string | null;
  }> = {};
  for (const [kind, entry] of store.entries()) {
    kinds[kind] = {
      sizeBytes: entry.sizeBytes,
      fetchedAt: entry.fetchedAt,
      ok: entry.ok,
      error: entry.error,
      firstChars: entry.xml.slice(0, PREVIEW_CHARS),
      tallyError: entry.ok ? detectTallyError(entry.xml) : null,
    };
  }
  return NextResponse.json({ kinds });
}
