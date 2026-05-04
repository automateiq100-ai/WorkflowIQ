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
  const { data, error } = await admin
    .from('workflowiq_clients')
    .select('selected_tools, theme, full_name, mobile')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    selected_tools: data?.selected_tools ?? user.user_metadata?.selected_tools ?? [],
    theme: data?.theme ?? 'dark',
    full_name: data?.full_name ?? user.user_metadata?.full_name ?? null,
    mobile: data?.mobile ?? user.user_metadata?.mobile ?? null,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const admin = adminClient();

  const updates: Record<string, unknown> = {};

  if (body.theme !== undefined) updates.theme = body.theme;
  if (body.full_name !== undefined) updates.full_name = body.full_name;
  if (body.mobile !== undefined) updates.mobile = body.mobile;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await admin.from('workflowiq_clients').update(updates).eq('id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
