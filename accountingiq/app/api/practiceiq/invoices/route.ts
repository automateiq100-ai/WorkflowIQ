import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();

  // Auto-generate invoice number from settings
  let invoiceNumber = body.invoice_number;
  if (!invoiceNumber) {
    const { data: settings } = await supabase
      .from('practiceiq_settings')
      .select('invoice_prefix, invoice_counter')
      .eq('owner_user_id', user.id)
      .single();
    const prefix = settings?.invoice_prefix ?? 'INV';
    const counter = (settings?.invoice_counter ?? 1);
    invoiceNumber = `${prefix}-${String(counter).padStart(4, '0')}`;
    await supabase
      .from('practiceiq_settings')
      .upsert({ owner_user_id: user.id, invoice_counter: counter + 1 });
  }

  const insert = { ...body, invoice_number: invoiceNumber, owner_user_id: user.id };
  delete insert.id;

  const { data, error } = await supabase
    .from('practiceiq_invoices')
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
