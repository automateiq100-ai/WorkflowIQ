import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

const DOCUMENTS_BACKEND_URL = process.env.DOCUMENTS_BACKEND_URL || 'http://localhost:8000';

// POST /api/practiceiq/documents/{client_id}/remind
// Body: { doc_type: string }
// Note: the [id] segment here is actually the *client_id*, not a document_id.
// Step B's Follow-up Queue page calls this route with row.client_id; the Python
// service composes a Hinglish reminder and sends it to that client's Telegram.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const docType = body.doc_type as string | undefined;
  if (!docType) return NextResponse.json({ error: 'doc_type required' }, { status: 400 });

  // Verify the client belongs to this CA before proxying.
  const { data: client, error: cErr } = await supabase
    .from('practiceiq_clients')
    .select('id, telegram_chat_id, consent_given')
    .eq('id', clientId)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!client) return NextResponse.json({ error: 'client not found' }, { status: 404 });
  if (!client.telegram_chat_id) {
    return NextResponse.json({ error: 'client has no telegram_chat_id set' }, { status: 422 });
  }
  if (!client.consent_given) {
    return NextResponse.json({ error: 'client has not given DPDP consent yet' }, { status: 422 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${DOCUMENTS_BACKEND_URL}/api/clients/${clientId}/remind`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-User-Id': ctx.userId,
      },
      body: JSON.stringify({ doc_type: docType }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return NextResponse.json(
      { error: `Shalini backend unreachable at ${DOCUMENTS_BACKEND_URL}: ${msg}` },
      { status: 503 }
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json({ error: `backend ${upstream.status}: ${text}` }, { status: upstream.status });
  }
  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json({ ok: true, raw: text });
  }
}
