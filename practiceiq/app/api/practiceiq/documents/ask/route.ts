import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

const DOCUMENTS_BACKEND_URL = process.env.DOCUMENTS_BACKEND_URL || 'http://localhost:8000';

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const messages = body.messages;
  const clientId = body.client_id ?? null;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages[] required' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${DOCUMENTS_BACKEND_URL}/api/shalini/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Firm-Id': ctx.firmId,
      },
      body: JSON.stringify({ client_id: clientId, messages }),
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
    return NextResponse.json({ reply: text });
  }
}
