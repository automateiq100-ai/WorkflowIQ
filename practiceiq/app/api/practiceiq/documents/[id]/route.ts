import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

const ALLOWED_STATUS = new Set(['received', 'verified', 'rejected', 'archived']);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const status = body.status as string | undefined;
  const rejectionReason = (body.rejection_reason as string | undefined) ?? null;

  if (!status || !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const update: Record<string, unknown> = { status };
  if (status === 'verified') {
    update.verified_by = ctx.userId;
    update.verified_at = new Date().toISOString();
    update.rejection_reason = null;
  } else if (status === 'rejected') {
    update.rejection_reason = rejectionReason;
    update.verified_by = null;
    update.verified_at = null;
  }

  const { data, error } = await supabase
    .from('practiceiq_documents')
    .update(update)
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Soft delete only — file stays in storage; row stays in DB with deleted_at set.
  const { error } = await supabase
    .from('practiceiq_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('firm_id', ctx.firmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
