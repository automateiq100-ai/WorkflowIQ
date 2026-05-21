// POST /api/tally/bridge-result
// Bridge submits the job result. Auth: Bearer <bridgeToken>.
//
// Two transports are accepted:
//   1. RAW (preferred): ?jobId=<id>[&error=<msg>] in the query string and the
//      report XML as the RAW request body — optionally gzip-compressed
//      (Content-Encoding: gzip). This avoids JSON-wrapping a multi-MB report
//      (which both inflates it ~30% via escaping and forces a giant
//      JSON.parse) and, with gzip, shrinks Tally XML ~10:1 on the wire — the
//      failure mode that made the heaviest reports (All Masters, Day Book)
//      return HTTP 400.
//   2. JSON (legacy): { jobId, xml?, error? } as an application/json body.
//      Kept so an un-updated bridge still works for the smaller reports.

import { NextResponse } from 'next/server';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { authenticateBridge } from '@/lib/connectors/session-store';
import { deliverResult } from '@/lib/connectors/bridge-bus';
import { bearerToken } from '@/lib/connectors/auth';

const gunzipAsync = promisify(zlib.gunzip);

export async function POST(req: Request) {
  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: 'Missing bearer token' }, { status: 401 });
  const session = await authenticateBridge(token);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  let jobId = url.searchParams.get('jobId') ?? undefined;
  let error = url.searchParams.get('error') ?? undefined;
  let xml = '';

  if (jobId) {
    // RAW transport — the body IS the report XML (empty on error), possibly
    // gzip-compressed. Read as bytes so we can inflate before decoding UTF-8.
    if (!error) {
      try {
        const buf = Buffer.from(await req.arrayBuffer());
        const enc = (req.headers.get('content-encoding') ?? '').toLowerCase();
        xml = enc.includes('gzip')
          ? (await gunzipAsync(buf)).toString('utf8')
          : buf.toString('utf8');
      } catch (err) {
        console.error(`[bridge-result] raw body read/gunzip failed err=${(err as Error).message}`);
        return NextResponse.json({ error: 'Could not read result body' }, { status: 400 });
      }
    }
  } else if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    // JSON transport (legacy).
    try {
      const body = await req.json() as { jobId?: string; xml?: string; error?: string };
      jobId = body.jobId;
      xml = body.xml ?? '';
      error = body.error;
    } catch (err) {
      console.error(
        `[bridge-result] JSON body parse failed `
        + `len=${req.headers.get('content-length') ?? '?'} err=${(err as Error).message}`,
      );
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

  // Diagnostic: surface size + first chars so we can correlate with the bridge
  // console when debugging "all amounts ₹0" reports.
  const preview = xml.slice(0, 200).replace(/\s+/g, ' ');
  console.log(`[bridge-result] jobId=${jobId} bridgeId=${session.bridgeId} len=${xml.length} error=${error ?? '-'} first200=${preview}`);

  const ok = deliverResult(session.bridgeId, jobId, xml, error);
  if (!ok) return NextResponse.json({ error: 'Unknown jobId' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
