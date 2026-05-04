import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; service_id: string }> },
) {
  const { id: clientId, service_id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const docTypes: Array<{ id?: string; doc_type: string; label?: string | null }> | undefined =
    Array.isArray(body.doc_types) ? body.doc_types : undefined;

  const patch: Record<string, unknown> = {};
  for (const k of ['service', 'cadence', 'deadline_day', 'deadline_month', 'followup_lead_days', 'active'] as const) {
    if (k in body) patch[k] = body[k];
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from('practiceiq_client_services')
      .update(patch)
      .eq('id', service_id)
      .eq('client_id', clientId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (docTypes) {
    const { error: delErr } = await supabase
      .from('practiceiq_client_service_doc_types')
      .delete()
      .eq('client_service_id', service_id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (docTypes.length) {
      const rows = docTypes.map(dt => ({
        client_service_id: service_id,
        owner_user_id: user.id,
        doc_type: dt.doc_type,
        label: dt.label ?? null,
      }));
      const { error: insErr } = await supabase
        .from('practiceiq_client_service_doc_types')
        .insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from('practiceiq_client_services')
    .select('*, doc_types:practiceiq_client_service_doc_types(*)')
    .eq('id', service_id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; service_id: string }> },
) {
  const { id: clientId, service_id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('practiceiq_client_services')
    .delete()
    .eq('id', service_id)
    .eq('client_id', clientId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
