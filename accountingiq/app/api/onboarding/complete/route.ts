import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    company_name, company_type, selected_tools,
    gst_applicable, gst_regular, tds_applicable,
    has_employees, has_fa_filter, is_goods, full_fy,
  } = body;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );

  const { error } = await admin.from('user_profiles').update({
    company_name: company_name ?? null,
    company_type: company_type ?? null,
    selected_tools: selected_tools ?? ['accountingiq'],
    gst_applicable: gst_applicable ?? false,
    gst_regular: gst_regular ?? false,
    tds_applicable: tds_applicable ?? false,
    has_employees: has_employees ?? false,
    has_fa_filter: has_fa_filter ?? false,
    is_goods: is_goods ?? false,
    full_fy: full_fy ?? true,
    onboarding_done: true,
  }).eq('id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
