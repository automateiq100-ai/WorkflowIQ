import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { pathname } = request.nextUrl;

  // Bridge transport routes are authenticated by Bearer token / pairing code,
  // NOT the Supabase session cookie — so this middleware has nothing to do for
  // them.  More importantly, running middleware on them at all forces the
  // request body through the middleware (proxy) runtime, which mangled the
  // multi-MB POST bodies of the heaviest reports (All Masters, Day Book) and
  // made bridge-result fail with HTTP 400 before the route handler ever saw a
  // clean body.  Bail out immediately, untouched.  (These are also excluded
  // from the matcher below, so normally middleware never even runs here — this
  // is belt-and-suspenders.)
  if (
    pathname === '/api/tally/bridge-poll' ||
    pathname === '/api/tally/bridge-result' ||
    pathname === '/api/tally/pair-claim' ||
    pathname === '/download/bridge'
  ) {
    return NextResponse.next({ request });
  }

  // Local dev bypass — skip Supabase auth check entirely
  if (process.env.NODE_ENV === 'development' && process.env.DEV_BYPASS_AUTH === 'true') {
    return supabaseResponse;
  }

  // Refresh session — must call getUser() not getSession() for security
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic =
    pathname === '/login' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    // Bridge API routes — authenticated by pairing code or Bearer token, not session cookie
    pathname === '/api/tally/pair-claim' ||
    pathname === '/api/tally/bridge-poll' ||
    pathname === '/api/tally/bridge-result' ||
    pathname === '/download/bridge';

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return supabaseResponse;
}

export const config = {
  // Exclude the bridge's token-authenticated transport routes from middleware
  // entirely.  They don't use the session cookie, and keeping the multi-MB
  // bridge-result POST out of the middleware (proxy) runtime is what lets the
  // heaviest reports through (it was truncating/mangling large bodies → 400).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/tally/bridge-poll|api/tally/bridge-result|api/tally/pair-claim|download/bridge).*)',
  ],
};
