import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const employeeId = await getMyEmployeeId(supabase, ctx);
  if (!employeeId) return NextResponse.json({ data: null });

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('practiceiq_attendance')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('employee_id', employeeId)
    .eq('date', today)
    .maybeSingle();
  return NextResponse.json({ data: data ?? null });
}
