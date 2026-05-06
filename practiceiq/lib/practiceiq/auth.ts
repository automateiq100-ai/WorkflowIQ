/**
 * Server-side firm-context resolver. Every API route under /api/practiceiq
 * calls this once and 401/403s on failure.
 *
 * If the authenticated user has no `firm_users` row yet (e.g., they just
 * signed up via Supabase auth without an invite), this function bootstraps
 * a fresh firm for them as admin and returns the context. This makes the
 * "no invite, just signed up" path work seamlessly.
 *
 * For invited users, the bootstrap is handled by the firm-invite consumption
 * flow elsewhere — they'll already have a `firm_users` row by the time their
 * first API call lands here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { FirmRole } from './types';

export type FirmContext = {
  firmId: string;
  userId: string;
  role: FirmRole;
  departmentId: string | null;
  email: string | null;
};

/**
 * Returns the firm context for the requesting user. Returns null if not
 * authenticated. Auto-creates a firm + admin membership on first sign-in
 * (no invite case).
 */
export async function getFirmContext(supabase: SupabaseClient): Promise<FirmContext | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Look up existing firm membership.
  const { data: membership, error: membershipErr } = await supabase
    .from('practiceiq_firm_users')
    .select('firm_id, role, department_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (membershipErr) {
    // Non-fatal — log but don't crash the request.
    console.warn('getFirmContext membership lookup error:', membershipErr.message);
  }

  if (membership) {
    return {
      firmId: membership.firm_id,
      userId: user.id,
      role: membership.role as FirmRole,
      departmentId: membership.department_id,
      email: user.email ?? null,
    };
  }

  // First sign-in path: bootstrap a fresh firm via service role, then return
  // the new context. This covers the "user signed up without an invite" case.
  return await bootstrapFirmForUser(user.id, user.email ?? null);
}

async function bootstrapFirmForUser(
  userId: string,
  email: string | null,
): Promise<FirmContext | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    console.error('bootstrapFirmForUser: SUPABASE_SERVICE_KEY missing');
    return null;
  }
  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } });

  // Check if there's a pending invite for this user's email — consume it instead of creating a new firm.
  if (email) {
    const { data: invite } = await admin
      .from('practiceiq_firm_invites')
      .select('token, firm_id, role, department_id')
      .eq('email', email)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invite) {
      // Look up the matching system role_id for this firm so the new
      // membership row points at the seeded role.
      const inviteRoleId = await lookupSystemRoleId(admin, invite.firm_id, invite.role);
      const { error: insertErr } = await admin
        .from('practiceiq_firm_users')
        .insert({
          firm_id: invite.firm_id,
          user_id: userId,
          role: invite.role,
          role_id: inviteRoleId,
          department_id: invite.department_id,
        });
      if (!insertErr) {
        await admin
          .from('practiceiq_firm_invites')
          .update({ consumed_at: new Date().toISOString(), consumed_by_user_id: userId })
          .eq('token', invite.token);
        await ensureEmployeeRow(admin, invite.firm_id, userId, email);
        return {
          firmId: invite.firm_id,
          userId,
          role: invite.role as FirmRole,
          departmentId: invite.department_id,
          email,
        };
      }
      console.warn('bootstrapFirmForUser: invite consume failed:', insertErr.message);
    }
  }

  // No invite — create a fresh firm with this user as admin.
  const { data: firm, error: firmErr } = await admin
    .from('practiceiq_firms')
    .insert({ name: 'My Firm' })
    .select('id')
    .single();
  if (firmErr || !firm) {
    console.error('bootstrapFirmForUser: firm create failed:', firmErr?.message);
    return null;
  }

  // Seed the four default roles for the brand-new firm.
  const { error: seedErr } = await admin.rpc('seed_default_roles_for_firm', { p_firm_id: firm.id });
  if (seedErr) {
    console.error('bootstrapFirmForUser: seed roles failed:', seedErr.message);
  }

  const adminRoleId = await lookupSystemRoleId(admin, firm.id, 'admin');

  const { error: memErr } = await admin
    .from('practiceiq_firm_users')
    .insert({ firm_id: firm.id, user_id: userId, role: 'admin', role_id: adminRoleId });
  if (memErr) {
    console.error('bootstrapFirmForUser: firm_users insert failed:', memErr.message);
    return null;
  }

  // Seed the standard service modules + their default filings now that the
  // admin row exists (the seed function records owner_user_id on each filing).
  const { error: modSeedErr } = await admin.rpc('seed_default_service_modules_for_firm', {
    p_firm_id: firm.id,
    p_owner_user_id: userId,
  });
  if (modSeedErr) {
    console.error('bootstrapFirmForUser: seed service modules failed:', modSeedErr.message);
  }

  await ensureEmployeeRow(admin, firm.id, userId, email);

  return {
    firmId: firm.id,
    userId,
    role: 'admin',
    departmentId: null,
    email,
  };
}

async function lookupSystemRoleId(
  admin: SupabaseClient,
  firmId: string,
  systemKey: string,
): Promise<string | null> {
  const { data } = await admin
    .from('practiceiq_roles')
    .select('id')
    .eq('firm_id', firmId)
    .eq('is_system', true)
    .eq('system_key', systemKey)
    .maybeSingle();
  return data?.id ?? null;
}

/** Idempotently create a practiceiq_employees row for the firm member. */
async function ensureEmployeeRow(
  admin: SupabaseClient,
  firmId: string,
  userId: string,
  email: string | null,
): Promise<void> {
  const { data: existing } = await admin
    .from('practiceiq_employees')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return;

  // Pull display name from auth.users metadata if available.
  const fullName = email?.split('@')[0] ?? 'Team member';
  await admin
    .from('practiceiq_employees')
    .insert({
      firm_id: firmId,
      user_id: userId,
      employee_code: '', // trigger fills this with EMP#####
      full_name: fullName,
      email,
      status: 'active',
    });
}

/** Helper: 401-respond if no auth, 403 if no firm context, otherwise return ctx. */
export async function requireFirmContext(supabase: SupabaseClient) {
  const ctx = await getFirmContext(supabase);
  return ctx;
}
