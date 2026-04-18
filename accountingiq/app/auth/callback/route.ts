import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'http';
  const origin = process.env.NEXT_PUBLIC_APP_URL
    ?? (forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin);
  const code = searchParams.get('code');
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as 'signup' | 'email' | 'recovery' | null;
  const isSignup = type === 'signup';
  const next = searchParams.get('next') ?? '/portal';

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

  let user = null;
  let error = null;

  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code);
    user = result.data.user;
    error = result.error;
  } else if (token_hash && type) {
    const result = await supabase.auth.verifyOtp({ token_hash, type });
    user = result.data.user;
    error = result.error;
  }

  if (!error && user) {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    );
    await admin.from('user_profiles').upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name ?? null,
      mobile: user.user_metadata?.mobile ?? null,
      last_seen: new Date().toISOString(),
      ...(isSignup ? {
        onboarding_done: true,
        selected_tools: user.user_metadata?.selected_tools ?? ['accountingiq'],
      } : {}),
    }, { onConflict: 'id' });
    await admin.rpc('increment_login_count', { user_id: user.id });
    await admin.from('login_sessions').insert({
      user_id: user.id,
      app: 'accountingiq',
    });
  }

  return NextResponse.redirect(new URL(next, origin));
}
