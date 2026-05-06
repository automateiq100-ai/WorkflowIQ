/**
 * Aggregate HR reports for managers/HR admin. Returns three buckets:
 *   - attendance: per-employee per-date check-in/out rows
 *   - leaves:     count of leave_type per employee for the window
 *   - timesheet:  per-employee billable vs non-billable hours total
 *
 * RLS allows visible rows only — managers see their reports, hrms_admin sees
 * the whole firm.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? defaultFrom;
  const to = url.searchParams.get('to') ?? defaultTo;

  const [{ data: employees }, { data: attendance }, { data: leaves }, { data: timesheet }] =
    await Promise.all([
      supabase
        .from('practiceiq_employees')
        .select('id, full_name, employee_code, designation, manager_id, department_id')
        .eq('firm_id', ctx.firmId)
        .order('full_name'),
      supabase
        .from('practiceiq_attendance')
        .select('*')
        .eq('firm_id', ctx.firmId)
        .gte('date', from)
        .lte('date', to)
        .order('date'),
      supabase
        .from('practiceiq_leave_requests')
        .select('*')
        .eq('firm_id', ctx.firmId)
        .gte('from_date', from)
        .lte('to_date', to),
      supabase
        .from('practiceiq_timesheet_entries')
        .select('*')
        .eq('firm_id', ctx.firmId)
        .gte('date', from)
        .lte('date', to),
    ]);

  return NextResponse.json({
    data: {
      window: { from, to },
      employees: employees ?? [],
      attendance: attendance ?? [],
      leaves: leaves ?? [],
      timesheet: timesheet ?? [],
    },
  });
}
