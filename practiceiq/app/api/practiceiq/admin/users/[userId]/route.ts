import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

/** Update a member's role assignment. Body: { role_id: string }. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const roleId = typeof body.role_id === 'string' ? body.role_id : null;
  if (!roleId) return NextResponse.json({ error: 'role_id required' }, { status: 400 });

  // Confirm the role belongs to this firm.
  const { data: role, error: rErr } = await supabase
    .from('practiceiq_roles')
    .select('id')
    .eq('id', roleId)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!role) return NextResponse.json({ error: 'role not in firm' }, { status: 400 });

  const { error } = await supabase
    .from('practiceiq_firm_users')
    .update({ role_id: roleId })
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }
  if (userId === ctx.userId) {
    return NextResponse.json({ error: 'admins cannot remove themselves' }, { status: 400 });
  }

  const { error } = await supabase
    .from('practiceiq_firm_users')
    .delete()
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
