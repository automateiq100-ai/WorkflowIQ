import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; account_id: string }> },
) {
  const { id: clientId, account_id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const k of ['label', 'is_primary'] as const) {
    if (k in body) patch[k] = body[k];
  }

  if (patch.is_primary === true) {
    await supabase
      .from('practiceiq_client_telegram_accounts')
      .update({ is_primary: false })
      .eq('client_id', clientId)
      .neq('id', account_id);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_client_telegram_accounts')
    .update(patch)
    .eq('id', account_id)
    .eq('client_id', clientId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; account_id: string }> },
) {
  const { id: clientId, account_id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('practiceiq_client_telegram_accounts')
    .delete()
    .eq('id', account_id)
    .eq('client_id', clientId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
