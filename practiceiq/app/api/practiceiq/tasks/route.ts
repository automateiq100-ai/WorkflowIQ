import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';
import { fyDateRange } from '@/lib/practiceiq/fy';

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const status = url.searchParams.get('status');
  const fy = url.searchParams.get('fy');
  const chargeable = url.searchParams.get('chargeable');
  const assignedTo = url.searchParams.get('assigned_to');

  let q = supabase.from('practiceiq_tasks').select('*').order('due_date', { ascending: true, nullsFirst: false });
  if (clientId) q = q.eq('client_id', clientId);
  if (status) q = q.eq('status', status);
  if (assignedTo) q = q.eq('assigned_to', assignedTo);
  if (chargeable === 'true' || chargeable === 'false') {
    q = q.eq('chargeable', chargeable === 'true');
  }
  if (fy) {
    // Either explicit financial_year tag, or due_date inside the FY range.
    const range = fyDateRange(fy);
    q = q.or(`financial_year.eq.${fy},and(due_date.gte.${range.from},due_date.lte.${range.to})`);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const insert: Record<string, unknown> = { ...body, firm_id: ctx.firmId, owner_user_id: ctx.userId };
  delete insert.id;
  delete insert.task_number; // server-assigned by trigger
  // Normalize new fields.
  if (typeof insert.chargeable !== 'boolean') insert.chargeable = true;

  const { data, error } = await supabase
    .from('practiceiq_tasks')
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
