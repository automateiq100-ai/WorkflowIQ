import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const docTypes: Array<{ id?: string; doc_type: string; label?: string | null }> | undefined =
    Array.isArray(body.doc_types) ? body.doc_types : undefined;

  const patch: Record<string, unknown> = {};
  for (const k of ['service', 'cadence', 'deadline_day', 'deadline_month', 'followup_lead_days', 'active'] as const) {
    if (k in body) patch[k] = body[k];
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from('practiceiq_service_templates')
      .update(patch)
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (docTypes) {
    const { error: delErr } = await supabase
      .from('practiceiq_service_template_doc_types')
      .delete()
      .eq('template_id', id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (docTypes.length) {
      const rows = docTypes.map(dt => ({
        template_id: id,
        firm_id: ctx.firmId, owner_user_id: ctx.userId,
        doc_type: dt.doc_type,
        label: dt.label ?? null,
      }));
      const { error: insErr } = await supabase
        .from('practiceiq_service_template_doc_types')
        .insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from('practiceiq_service_templates')
    .select('*, doc_types:practiceiq_service_template_doc_types(*)')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('practiceiq_service_templates')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
