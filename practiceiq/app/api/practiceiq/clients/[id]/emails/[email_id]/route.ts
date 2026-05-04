import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; email_id: string }> },
) {
  const { id: clientId, email_id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const k of ['email', 'label', 'is_primary'] as const) {
    if (k in body) patch[k] = body[k];
  }

  if (patch.is_primary === true) {
    await supabase
      .from('practiceiq_client_emails')
      .update({ is_primary: false })
      .eq('client_id', clientId)
      .neq('id', email_id);
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_client_emails')
    .update(patch)
    .eq('id', email_id)
    .eq('client_id', clientId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; email_id: string }> },
) {
  const { id: clientId, email_id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('practiceiq_client_emails')
    .delete()
    .eq('id', email_id)
    .eq('client_id', clientId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
