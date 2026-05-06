import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('practiceiq_client_telegram_accounts')
    .select('*')
    .eq('client_id', id)
    .order('added_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();

  if (body.telegram_chat_id === undefined || body.telegram_chat_id === null) {
    return NextResponse.json({ error: 'telegram_chat_id is required' }, { status: 400 });
  }

  const chatIdNum = Number(body.telegram_chat_id);
  if (!Number.isFinite(chatIdNum) || !Number.isInteger(chatIdNum)) {
    return NextResponse.json({ error: 'telegram_chat_id must be an integer' }, { status: 400 });
  }

  const insert = {
    client_id: clientId,
    firm_id: ctx.firmId, owner_user_id: ctx.userId,
    telegram_chat_id: chatIdNum,
    telegram_username: body.telegram_username ?? null,
    telegram_first_name: body.telegram_first_name ?? null,
    label: body.label ?? null,
    is_primary: !!body.is_primary,
    consent_given: !!body.consent_given,
    consent_at: body.consent_given ? new Date().toISOString() : null,
  };

  if (insert.is_primary) {
    await supabase
      .from('practiceiq_client_telegram_accounts')
      .update({ is_primary: false })
      .eq('client_id', clientId);
  }

  const { data, error } = await supabase
    .from('practiceiq_client_telegram_accounts')
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
