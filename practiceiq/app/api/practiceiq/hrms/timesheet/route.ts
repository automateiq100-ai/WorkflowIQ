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
    .from('practiceiq_timesheet_entries')
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

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const employeeId = await getMyEmployeeId(supabase, ctx);
  if (!employeeId) return NextResponse.json({ error: 'no employee record' }, { status: 400 });

  const body = await req.json();
  const hours = parseFloat(body.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return NextResponse.json({ error: 'hours must be in (0, 24]' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_timesheet_entries')
    .insert({
      firm_id: ctx.firmId,
      employee_id: employeeId,
      date: body.date ?? new Date().toISOString().slice(0, 10),
      client_id: body.client_id ?? null,
      task_id: body.task_id ?? null,
      hours,
      description: body.description ?? null,
      billable: body.billable !== false,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
