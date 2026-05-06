/**
 * Combined feed of pending leave + expense decisions for direct reports.
 * Visibility is enforced by RLS (manager + admin policies).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const myEmployeeId = await getMyEmployeeId(supabase, ctx);

  const [{ data: leaves }, { data: expenses }, { data: employees }] = await Promise.all([
    supabase
      .from('practiceiq_leave_requests')
      .select('*')
      .eq('firm_id', ctx.firmId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('practiceiq_expense_claims')
      .select('*')
      .eq('firm_id', ctx.firmId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase
      .from('practiceiq_employees')
      .select('id, full_name, employee_code, manager_id')
      .eq('firm_id', ctx.firmId),
  ]);

  return NextResponse.json({
    data: {
      my_employee_id: myEmployeeId,
      leaves: leaves ?? [],
      expenses: expenses ?? [],
      employees: employees ?? [],
    },
  });
}
