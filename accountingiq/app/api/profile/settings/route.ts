import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import type { CompanyProfile } from '@/lib/types';
import { dbProfileToFilters } from '@/lib/types';

async function getUser() {
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
  return user;
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  );
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = adminClient();
  const { data, error } = await admin
    .from('user_profiles')
    .select('company_name, company_type, selected_tools, gst_applicable, gst_regular, tds_applicable, has_employees, has_fa_filter, is_goods, full_fy, theme')
    .eq('id', user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    company_name: data.company_name,
    company_type: data.company_type,
    selected_tools: data.selected_tools ?? [],
    filters: dbProfileToFilters(data),
    theme: data.theme ?? 'dark',
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const admin = adminClient();

  const updates: Record<string, unknown> = {};

  if (body.theme !== undefined) updates.theme = body.theme;
  if (body.company_name !== undefined) updates.company_name = body.company_name;
  if (body.company_type !== undefined) updates.company_type = body.company_type;

  if (body.filters) {
    const f = body.filters as CompanyProfile;
    updates.gst_applicable = f.gstApplicable;
    updates.gst_regular    = f.gstRegular;
    updates.tds_applicable = f.tdsApplicable;
    updates.has_employees  = f.hasEmployees;
    updates.has_fa_filter  = f.hasFAfilter;
    updates.is_goods       = f.isGoods;
    updates.full_fy        = f.fullFY;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin.from('user_profiles').update(updates).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
