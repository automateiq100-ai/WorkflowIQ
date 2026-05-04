import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('practiceiq_service_templates')
    .select('*, doc_types:practiceiq_service_template_doc_types(*)')
    .order('service', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const docTypes: Array<{ doc_type: string; label?: string | null }> = Array.isArray(body.doc_types)
    ? body.doc_types
    : [];

  const insert = {
    owner_user_id: user.id,
    service: body.service,
    cadence: body.cadence,
    deadline_day: body.deadline_day ?? null,
    deadline_month: body.deadline_month ?? null,
    followup_lead_days: body.followup_lead_days ?? null,
    active: body.active ?? true,
  };

  const { data: template, error } = await supabase
    .from('practiceiq_service_templates')
    .insert(insert)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (docTypes.length) {
    const rows = docTypes.map(dt => ({
      template_id: template.id,
      owner_user_id: user.id,
      doc_type: dt.doc_type,
      label: dt.label ?? null,
    }));
    const { error: dtErr } = await supabase
      .from('practiceiq_service_template_doc_types')
      .insert(rows);
    if (dtErr) return NextResponse.json({ error: dtErr.message }, { status: 500 });
  }

  const { data: full } = await supabase
    .from('practiceiq_service_templates')
    .select('*, doc_types:practiceiq_service_template_doc_types(*)')
    .eq('id', template.id)
    .single();

  return NextResponse.json({ data: full });
}
