import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name.trim();
  if (typeof body.description === 'string' || body.description === null) patch.description = body.description;
  if (typeof body.icon === 'string') patch.icon = body.icon;
  if (typeof body.color === 'string') patch.color = body.color;
  if (typeof body.sort_order === 'number') patch.sort_order = body.sort_order;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('practiceiq_service_modules')
    .update(patch)
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  // RLS prevents deleting system modules; check defensively for a clearer 400.
  const { data: mod } = await supabase
    .from('practiceiq_service_modules')
    .select('is_system')
    .eq('id', id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!mod) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (mod.is_system) return NextResponse.json({ error: 'cannot delete system module' }, { status: 400 });

  const { error } = await supabase
    .from('practiceiq_service_modules')
    .delete()
    .eq('id', id)
    .eq('firm_id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
