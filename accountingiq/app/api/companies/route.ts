import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

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

  const { data: companies, error } = await admin
    .from('companies')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-migrate: if no companies yet and user_profiles has a company_name, seed one
  if (!companies || companies.length === 0) {
    const { data: profile } = await admin
      .from('user_profiles')
      .select('company_name, company_type, gst_applicable, gst_regular, tds_applicable, has_employees, has_fa_filter, is_goods, full_fy')
      .eq('id', user.id)
      .single();

    if (profile?.company_name) {
      const { data: inserted, error: insertErr } = await admin
        .from('companies')
        .insert({
          user_id: user.id,
          name: profile.company_name,
          company_type: profile.company_type ?? null,
          gst_applicable: profile.gst_applicable ?? false,
          gst_regular:    profile.gst_regular ?? false,
          tds_applicable: profile.tds_applicable ?? false,
          has_employees:  profile.has_employees ?? false,
          has_fa_filter:  profile.has_fa_filter ?? false,
          is_goods:       profile.is_goods ?? false,
          full_fy:        profile.full_fy ?? true,
        })
        .select('*')
        .single();

      if (!insertErr && inserted) {
        return NextResponse.json({ companies: [inserted] });
      }
    }

    return NextResponse.json({ companies: [] });
  }

  return NextResponse.json({ companies });
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Company name is required' }, { status: 400 });
  }

  const admin = adminClient();
  const { data, error } = await admin
    .from('companies')
    .insert({
      user_id:        user.id,
      name:           body.name.trim(),
      company_type:   body.company_type || null,
      gst_applicable: body.gst_applicable ?? false,
      gst_regular:    body.gst_regular ?? false,
      tds_applicable: body.tds_applicable ?? false,
      has_employees:  body.has_employees ?? false,
      has_fa_filter:  body.has_fa_filter ?? false,
      is_goods:       body.is_goods ?? false,
      full_fy:        body.full_fy ?? true,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}
