import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const decision = body.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be approved|rejected' }, { status: 400 });
  }
  const approverEmployeeId = await getMyEmployeeId(supabase, ctx);

  const { data, error } = await supabase
    .from('practiceiq_expense_claims')
    .update({
      status: decision,
      decision_note: body.note ?? null,
      decided_at: new Date().toISOString(),
      approver_employee_id: approverEmployeeId,
    })
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
