import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'self'; // self|all
  const status = url.searchParams.get('status');

  let q = supabase
    .from('practiceiq_leave_requests')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false });

  if (scope === 'self') {
    const employeeId = await getMyEmployeeId(supabase, ctx);
    if (!employeeId) return NextResponse.json({ data: [] });
    q = q.eq('employee_id', employeeId);
  }
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const employeeId = await getMyEmployeeId(supabase, ctx);
  if (!employeeId) return NextResponse.json({ error: 'no employee record' }, { status: 400 });

  const body = await req.json();
  const from = body.from_date as string;
  const to = body.to_date as string;
  if (!from || !to) return NextResponse.json({ error: 'from_date and to_date required' }, { status: 400 });

  // Days = inclusive count.
  const days = body.days ?? Math.max(
    1,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1,
  );

  const { data, error } = await supabase
    .from('practiceiq_leave_requests')
    .insert({
      firm_id: ctx.firmId,
      employee_id: employeeId,
      leave_type: body.leave_type ?? 'casual',
      from_date: from,
      to_date: to,
      days,
      reason: body.reason ?? null,
      status: 'pending',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
