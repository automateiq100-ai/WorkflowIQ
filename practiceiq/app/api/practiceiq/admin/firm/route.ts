import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('practiceiq_firms')
    .select('*')
    .eq('id', ctx.firmId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const body = await req.json();
  delete body.id;
  delete body.created_at;
  const { data, error } = await supabase
    .from('practiceiq_firms')
    .update(body)
    .eq('id', ctx.firmId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
