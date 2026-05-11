/**
 * GET /api/practiceiq/hrms/attendance?from=&to=&employee_id=
 * Lists attendance rows. Without employee_id, returns the requester's own.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const employeeIdParam = url.searchParams.get('employee_id');
  const employeeId = employeeIdParam ?? (await getMyEmployeeId(supabase, ctx));
  if (!employeeId) return NextResponse.json({ data: [] });

  let q = supabase
    .from('practiceiq_attendance')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('employee_id', employeeId)
    .order('date', { ascending: false });
  if (from) q = q.gte('date', from);
  if (to) q = q.lte('date', to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
