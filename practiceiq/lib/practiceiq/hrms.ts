/** Shared helpers for HRMS API routes. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FirmContext } from './auth';

/** Resolve the requester's employee row in their firm; null if none exists. */
export async function getMyEmployeeId(
  supabase: SupabaseClient,
  ctx: FirmContext,
): Promise<string | null> {
  const { data } = await supabase
    .from('practiceiq_employees')
    .select('id')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  return data?.id ?? null;
}
