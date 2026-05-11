import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [{ data: modules, error }, { data: counts }] = await Promise.all([
    supabase
      .from('practiceiq_service_modules')
      .select('*')
      .eq('firm_id', ctx.firmId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('practiceiq_service_templates')
      .select('module_id')
      .eq('firm_id', ctx.firmId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Count filings per module client-side.
  const countByModule = new Map<string, number>();
  for (const t of counts ?? []) {
    if (!t.module_id) continue;
    countByModule.set(t.module_id, (countByModule.get(t.module_id) ?? 0) + 1);
  }

  const data = (modules ?? []).map(m => ({
    ...m,
    filing_count: countByModule.get(m.id) ?? 0,
  }));

  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.role !== 'admin') {
    return NextResponse.json({ error: 'admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  // Auto-derive code from name when not provided: uppercase, alnum-only.
  let code: string = typeof body.code === 'string' && body.code.trim()
    ? body.code.trim().toUpperCase()
    : name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24);
  if (!code) code = 'CUSTOM';

  const insert = {
    firm_id: ctx.firmId,
    name,
    code,
    description: body.description ?? null,
    icon: body.icon ?? '📁',
    color: body.color ?? 'grey',
    sort_order: typeof body.sort_order === 'number' ? body.sort_order : 500,
    is_system: false,
  };

  const { data, error } = await supabase
    .from('practiceiq_service_modules')
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: { ...data, filing_count: 0 } });
}
