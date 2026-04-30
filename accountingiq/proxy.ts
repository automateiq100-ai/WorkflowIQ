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

  // Local dev bypass — skip Supabase auth check entirely
  if (process.env.NODE_ENV === 'development' && process.env.DEV_BYPASS_AUTH === 'true') {
    if (pathname === '/') return NextResponse.redirect(new URL('/accountingiq', request.url));
    return supabaseResponse;
  }

  // Refresh session — must call getUser() not getSession() for security
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic =
    pathname === '/login' ||
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

  // Root → portal (tool selection page)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/portal', request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
