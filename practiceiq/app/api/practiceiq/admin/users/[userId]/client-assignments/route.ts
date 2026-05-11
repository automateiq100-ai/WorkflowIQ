import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET(_req: Request, ctxParams: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctxParams.params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Self or admin can view assignments.
  if (ctx.userId !== userId && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('practiceiq_user_client_assignments')
    .select('client_id, assigned_at')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/**
 * Replaces the user's assignment list with the given client_ids array.
 * Body: { client_ids: string[] }
 */
export async function PUT(req: Request, ctxParams: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctxParams.params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.client_ids)
    ? body.client_ids.filter((x: unknown): x is string => typeof x === 'string')
    : [];

  // Wipe existing then insert new.
  const { error: delErr } = await supabase
    .from('practiceiq_user_client_assignments')
    .delete()
    .eq('firm_id', ctx.firmId)
    .eq('user_id', userId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (ids.length > 0) {
    const rows = ids.map(client_id => ({
      firm_id: ctx.firmId,
      user_id: userId,
      client_id,
      assigned_by: ctx.userId,
    }));
    const { error: insErr } = await supabase
      .from('practiceiq_user_client_assignments')
      .insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: ids.length });
}
