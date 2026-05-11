import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'http';
  const origin = process.env.NEXT_PUBLIC_APP_URL
    ?? (forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(request.url).origin);
  const code = searchParams.get('code');
  // `next` is a PracticeIQ-relative path (without the /practiceiq prefix). For
  // back-compat, strip a leading /practiceiq if a caller accidentally included
  // the basePath.
  const rawNext = searchParams.get('next') ?? '/dashboard';
  const stripped = rawNext.startsWith('/practiceiq')
    ? rawNext.slice('/practiceiq'.length) || '/'
    : rawNext;
  const next = isSafePracticeIqPath(stripped) ? stripped : '/dashboard';

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

  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  // basePath is /practiceiq, so redirect to /practiceiq/dashboard on the server.
  return NextResponse.redirect(new URL(`/practiceiq${next}`, origin));
}

/** Defense against open-redirect via the `next` query param. */
function isSafePracticeIqPath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  if (!p.startsWith('/')) return false;
  if (p.startsWith('//')) return false;        // protocol-relative
  if (p.includes('://')) return false;         // absolute URL
  return true;
}
