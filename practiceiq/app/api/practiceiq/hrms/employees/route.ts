import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('practiceiq_employees')
    .select('*')
    .eq('firm_id', ctx.firmId)
    .order('full_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const insert = {
    firm_id: ctx.firmId,
    full_name: typeof body.full_name === 'string' ? body.full_name.trim() : '',
    email: body.email ?? null,
    phone: body.phone ?? null,
    designation: body.designation ?? null,
    department_id: body.department_id ?? null,
    manager_id: body.manager_id ?? null,
    date_of_joining: body.date_of_joining ?? null,
    user_id: body.user_id ?? null,
    status: body.status === 'inactive' ? 'inactive' : 'active',
    employee_code: '', // trigger fills
  };
  if (!insert.full_name) {
    return NextResponse.json({ error: 'full_name required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_employees')
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
