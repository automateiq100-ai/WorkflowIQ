/**
 * Returns the requester's own employee row + permissions snapshot. Used by
 * the shell to show the right menu items and to wire the check-in/out badge.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getPermissionMap } from '@/lib/practiceiq/permissions';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [{ data: employee }, permissions] = await Promise.all([
    supabase
      .from('practiceiq_employees')
      .select('*')
      .eq('firm_id', ctx.firmId)
      .eq('user_id', ctx.userId)
      .maybeSingle(),
    getPermissionMap(supabase, ctx),
  ]);

  return NextResponse.json({
    data: {
      employee: employee ?? null,
      permissions,
      role: ctx.role,
      firm_id: ctx.firmId,
    },
  });
}
