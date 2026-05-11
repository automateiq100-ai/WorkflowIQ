import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { ALL_PERMISSION_MODULES, type PermissionModule } from '@/lib/practiceiq/types';

/**
 * Bulk update of a role's permission grid.
 * Body: { permissions: { [module]: { can_read: bool, can_write: bool } } }
 * Modules missing from the body are reset to no-access.
 */
export async function PUT(req: Request, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  // Make sure the role belongs to the requester's firm.
  const { data: role } = await supabase
    .from('practiceiq_roles')
    .select('id')
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!role) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const incoming = (body.permissions ?? {}) as Record<string, { can_read?: boolean; can_write?: boolean }>;

  const grid = ALL_PERMISSION_MODULES.map(m => ({
    role_id: id,
    module: m as PermissionModule,
    can_read: !!incoming[m]?.can_read,
    can_write: !!incoming[m]?.can_write,
  }));

  // Upsert (role_id, module) — replaces all existing rows for this role.
  const { error: delErr } = await supabase
    .from('practiceiq_role_permissions')
    .delete()
    .eq('role_id', id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const { error: insErr } = await supabase
    .from('practiceiq_role_permissions')
    .insert(grid);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ data: { permissions: grid } });
}
