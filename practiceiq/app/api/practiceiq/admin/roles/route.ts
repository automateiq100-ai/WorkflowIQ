import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { ALL_PERMISSION_MODULES, type PermissionModule } from '@/lib/practiceiq/types';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: roles, error } = await supabase
    .from('practiceiq_roles')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('is_system', { ascending: false })
    .order('name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach permissions in one extra query.
  const roleIds = (roles ?? []).map(r => r.id);
  let permissions: Array<{ role_id: string; module: string; can_read: boolean; can_write: boolean }> = [];
  if (roleIds.length > 0) {
    const { data: perms, error: pErr } = await supabase
      .from('practiceiq_role_permissions')
      .select('role_id, module, can_read, can_write')
      .in('role_id', roleIds);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    permissions = perms ?? [];
  }

  return NextResponse.json({ data: { roles: roles ?? [], permissions } });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const description = typeof body.description === 'string' ? body.description : null;
  const restrictToAssignedClients = body.restrict_to_assigned_clients === true;

  // Build a permissions grid from request body, defaulting to no access.
  const incoming = (body.permissions ?? {}) as Record<string, { can_read?: boolean; can_write?: boolean }>;
  const grid: { module: PermissionModule; can_read: boolean; can_write: boolean }[] =
    ALL_PERMISSION_MODULES.map(m => ({
      module: m,
      can_read: !!incoming[m]?.can_read,
      can_write: !!incoming[m]?.can_write,
    }));

  const { data: role, error } = await supabase
    .from('practiceiq_roles')
    .insert({
      firm_id: ctx.firmId,
      name,
      description,
      is_system: false,
      restrict_to_assigned_clients: restrictToAssignedClients,
    })
    .select()
    .single();
  if (error || !role) return NextResponse.json({ error: error?.message ?? 'failed' }, { status: 500 });

  const { error: pErr } = await supabase
    .from('practiceiq_role_permissions')
    .insert(grid.map(g => ({ ...g, role_id: role.id })));
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  return NextResponse.json({ data: role });
}
