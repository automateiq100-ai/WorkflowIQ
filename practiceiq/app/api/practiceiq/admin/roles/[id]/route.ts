import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET(_req: Request, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: role, error } = await supabase
    .from('practiceiq_roles')
    .select('*')
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!role) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: perms } = await supabase
    .from('practiceiq_role_permissions')
    .select('module, can_read, can_write')
    .eq('role_id', id);

  return NextResponse.json({ data: { role, permissions: perms ?? [] } });
}

export async function PATCH(req: Request, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description;
  if (typeof body.restrict_to_assigned_clients === 'boolean') {
    patch.restrict_to_assigned_clients = body.restrict_to_assigned_clients;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_roles')
    .update(patch)
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(_req: Request, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  // RLS prevents deleting system roles, but check defensively.
  const { data: role, error: rErr } = await supabase
    .from('practiceiq_roles')
    .select('is_system')
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  if (!role) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (role.is_system) return NextResponse.json({ error: 'cannot delete system role' }, { status: 400 });

  const { error } = await supabase
    .from('practiceiq_roles')
    .delete()
    .eq('id', id)
    .eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
