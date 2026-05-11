import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { getMyEmployeeId } from '@/lib/practiceiq/hrms';

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') ?? 'self';
  const status = url.searchParams.get('status');

  let q = supabase
    .from('practiceiq_expense_claims')
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
  const amount = parseFloat(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_expense_claims')
    .insert({
      firm_id: ctx.firmId,
      employee_id: employeeId,
      claim_date: body.claim_date ?? new Date().toISOString().slice(0, 10),
      category: body.category ?? 'other',
      amount,
      currency: body.currency ?? 'INR',
      description: body.description ?? null,
      receipt_url: body.receipt_url ?? null,
      status: 'pending',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
