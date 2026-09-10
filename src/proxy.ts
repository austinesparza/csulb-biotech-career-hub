// Gate /admin/* behind a Supabase session. Officer membership is re-checked
// server-side in every action via requireOfficer(); this is just the first door.
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, securityHeaders } from '@/lib/security-headers';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    development: process.env.NODE_ENV === 'development',
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const applyHeaders = <T extends NextResponse>(target: T): T => {
    for (const [name, value] of Object.entries(securityHeaders(csp))) target.headers.set(name, value);
    if (isAdmin) target.headers.set('Cache-Control', 'private, no-store');
    return target;
  };
  const isAdmin = request.nextUrl.pathname.startsWith('/admin');
  if (!isAdmin) return applyHeaders(response);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list: CookieToSet[]) =>
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname.startsWith('/admin/login');
  if (!user && !isLogin) {
    const redirect = NextResponse.redirect(new URL('/admin/login', request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return applyHeaders(redirect);
  }

  if (user) {
    const { data: isOfficer, error: officerError } = await supabase.rpc('is_officer');
    if (officerError) {
      console.error('[auth/proxy] officer check failed', {
        code: officerError.code,
        message: officerError.message,
      });
    }

    if (isOfficer === true && isLogin) {
      const redirect = NextResponse.redirect(new URL('/admin', request.url));
      for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
      return applyHeaders(redirect);
    }

    if (isOfficer !== true) {
      await supabase.auth.signOut();
      if (!isLogin) {
        const target = new URL('/admin/login', request.url);
        target.searchParams.set('error', officerError ? 'unavailable' : 'not_officer');
        const redirect = NextResponse.redirect(target);
        for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
        return applyHeaders(redirect);
      }
    }
  }
  return applyHeaders(response);
}

export const config = {
  matcher: [{
    source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    missing: [
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ],
  }],
};
