/**
 * Permission helpers for API routes. Every /api/practiceiq/* route should call
 * `requirePermission(supabase, ctx, module, level)` after `getFirmContext()`,
 * unless RLS alone is enough (RLS already enforces all reads/writes via
 * user_can_read / user_can_write — but throwing a 403 in the API gives a
 * clearer error and avoids "empty result + write succeeded with 0 rows"
 * confusion).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FirmContext } from './auth';
import type {
  PermissionModule,
  PermissionMap,
} from './types';
import { ALL_PERMISSION_MODULES } from './types';

export type PermissionLevel = 'read' | 'write';

/** Reads the requester's effective module permissions for their role. */
export async function getPermissionMap(
  supabase: SupabaseClient,
  ctx: FirmContext,
): Promise<PermissionMap> {
  // Default = no access on any module.
  const map = ALL_PERMISSION_MODULES.reduce((acc, m) => {
    acc[m] = { can_read: false, can_write: false };
    return acc;
  }, {} as PermissionMap);

  // Membership row gives us role_id; permissions table gives us the grid.
  const { data: membership } = await supabase
    .from('practiceiq_firm_users')
    .select('role_id')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', ctx.userId)
    .maybeSingle();

  if (!membership?.role_id) {
    // Defensive: an admin (system_key=admin) may exist without role_id
    // backfill yet — give admins full access.
    if (ctx.role === 'admin') {
      for (const m of ALL_PERMISSION_MODULES) {
        map[m] = { can_read: true, can_write: true };
      }
    }
    return map;
  }

  const { data: rows } = await supabase
    .from('practiceiq_role_permissions')
    .select('module, can_read, can_write')
    .eq('role_id', membership.role_id);

  for (const r of rows ?? []) {
    const mod = r.module as PermissionModule;
    if (ALL_PERMISSION_MODULES.includes(mod)) {
      map[mod] = { can_read: !!r.can_read, can_write: !!r.can_write };
    }
  }
  return map;
}

/** Throws an Error with a `.status` field so route handlers can pass it through. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 403 if the requester's role does not have the requested level on the module. */
export async function requirePermission(
  supabase: SupabaseClient,
  ctx: FirmContext,
  module: PermissionModule,
  level: PermissionLevel,
): Promise<void> {
  const map = await getPermissionMap(supabase, ctx);
  const perms = map[module];
  if (!perms) throw new HttpError(403, `permission denied for ${module}`);
  if (level === 'read' && !perms.can_read) {
    throw new HttpError(403, `read permission denied for ${module}`);
  }
  if (level === 'write' && !perms.can_write) {
    throw new HttpError(403, `write permission denied for ${module}`);
  }
}

/**
 * Returns the list of client_ids the requester can access, or `null` when
 * unrestricted. API routes that filter their own queries (e.g., GET /tasks
 * server-side filter) should consult this and apply `.in('client_id', ids)`
 * when the value is non-null.
 */
export async function getEffectiveClientIds(
  supabase: SupabaseClient,
  ctx: FirmContext,
): Promise<string[] | null> {
  // Find the role's restrict flag.
  const { data: membership } = await supabase
    .from('practiceiq_firm_users')
    .select('role_id')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (!membership?.role_id) return null;

  const { data: role } = await supabase
    .from('practiceiq_roles')
    .select('restrict_to_assigned_clients')
    .eq('id', membership.role_id)
    .maybeSingle();
  if (!role?.restrict_to_assigned_clients) return null;

  const { data: rows } = await supabase
    .from('practiceiq_user_client_assignments')
    .select('client_id')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', ctx.userId);
  return (rows ?? []).map(r => r.client_id);
}
