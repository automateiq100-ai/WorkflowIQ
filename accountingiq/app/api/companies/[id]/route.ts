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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const admin = adminClient();
  const { data, error } = await admin
    .from('companies')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ company: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const admin = adminClient();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined)           updates.name           = body.name;
  if (body.company_type !== undefined)   updates.company_type   = body.company_type || null;
  if (body.gst_applicable !== undefined) updates.gst_applicable = body.gst_applicable;
  if (body.gst_regular !== undefined)    updates.gst_regular    = body.gst_regular;
  if (body.tds_applicable !== undefined) updates.tds_applicable = body.tds_applicable;
  if (body.has_employees !== undefined)  updates.has_employees  = body.has_employees;
  if (body.has_fa_filter !== undefined)  updates.has_fa_filter  = body.has_fa_filter;
  if (body.is_goods !== undefined)       updates.is_goods       = body.is_goods;
  if (body.full_fy !== undefined)        updates.full_fy        = body.full_fy;

  if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true });

  const { data, error } = await admin
    .from('companies')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ company: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const admin = adminClient();
  const { error } = await admin
    .from('companies')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
