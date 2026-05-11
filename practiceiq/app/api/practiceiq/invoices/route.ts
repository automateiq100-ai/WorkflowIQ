import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');

  let q = supabase.from('practiceiq_invoices').select('*').order('issue_date', { ascending: false });
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();

  let invoiceNumber = body.invoice_number;
  if (!invoiceNumber) {
    const { data: settings } = await supabase
      .from('practiceiq_settings')
      .select('invoice_prefix, invoice_counter')
      .eq('firm_id', ctx.firmId)
      .single();
    const prefix = settings?.invoice_prefix ?? 'INV';
    const counter = (settings?.invoice_counter ?? 1);
    invoiceNumber = `${prefix}-${String(counter).padStart(4, '0')}`;
    await supabase
      .from('practiceiq_settings')
      .upsert({ firm_id: ctx.firmId, owner_user_id: ctx.userId, invoice_counter: counter + 1 });
  }

  const insert = { ...body, invoice_number: invoiceNumber, firm_id: ctx.firmId, owner_user_id: ctx.userId };
  delete insert.id;

  const { data, error } = await supabase
    .from('practiceiq_invoices')
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
