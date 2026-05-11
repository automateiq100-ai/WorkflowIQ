import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('practiceiq_client_services')
    .select('*, doc_types:practiceiq_client_service_doc_types(*)')
    .eq('client_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const docTypes: Array<{ doc_type: string; label?: string | null }> = Array.isArray(body.doc_types)
    ? body.doc_types
    : [];

  const insert = {
    client_id: clientId,
    firm_id: ctx.firmId, owner_user_id: ctx.userId,
    service: body.service,
    cadence: body.cadence,
    deadline_day: body.deadline_day ?? null,
    deadline_month: body.deadline_month ?? null,
    followup_lead_days: body.followup_lead_days ?? null,
    active: body.active ?? true,
  };

  const { data: service, error } = await supabase
    .from('practiceiq_client_services')
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (docTypes.length) {
    const rows = docTypes.map(dt => ({
      client_service_id: service.id,
      firm_id: ctx.firmId, owner_user_id: ctx.userId,
      doc_type: dt.doc_type,
      label: dt.label ?? null,
    }));
    const { error: dtErr } = await supabase
      .from('practiceiq_client_service_doc_types')
      .insert(rows);
    if (dtErr) return NextResponse.json({ error: dtErr.message }, { status: 500 });
  }

  const { data: full } = await supabase
    .from('practiceiq_client_services')
    .select('*, doc_types:practiceiq_client_service_doc_types(*)')
    .eq('id', service.id)
    .single();

  return NextResponse.json({ data: full });
}
