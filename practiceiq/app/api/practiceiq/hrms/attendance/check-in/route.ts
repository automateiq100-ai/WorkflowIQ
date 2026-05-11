/**
 * POST /api/practiceiq/hrms/attendance/check-in
 * Idempotent: if today's row exists with check_in_at set, returns it unchanged.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function POST() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const employeeId = await getMyEmployeeId(supabase, ctx);
  if (!employeeId) {
    return NextResponse.json({ error: 'no employee record for this user' }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // Try to find an existing row.
  const { data: existing } = await supabase
    .from('practiceiq_attendance')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .eq('employee_id', employeeId)
    .eq('date', today)
    .maybeSingle();

  if (existing) {
    if (existing.check_in_at) return NextResponse.json({ data: existing });
    const { data, error } = await supabase
      .from('practiceiq_attendance')
      .update({ check_in_at: now })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  const { data, error } = await supabase
    .from('practiceiq_attendance')
    .insert({
      firm_id: ctx.firmId,
      employee_id: employeeId,
      date: today,
      check_in_at: now,
      source: 'web',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
