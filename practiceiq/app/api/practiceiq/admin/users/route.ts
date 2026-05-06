import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getFirmContext } from '@/lib/practiceiq/auth';

export async function GET() {
  const supabase = await createClient();
  const ctx = await getFirmContext(supabase);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: members, error } = await supabase
    .from('practiceiq_firm_users')
    .select('firm_id, user_id, role, department_id, created_at')
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with email via service-role admin API (auth.users isn't directly readable).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ data: members ?? [] });
  }
  const admin = createServiceClient(url, serviceKey, { auth: { persistSession: false } });

  const enriched = await Promise.all((members ?? []).map(async m => {
    const { data: userInfo } = await admin.auth.admin.getUserById(m.user_id);
    return { ...m, email: userInfo?.user?.email ?? null };
  }));

  return NextResponse.json({ data: enriched });
}
