// Gate /admin/* behind a Supabase session. Officer membership is re-checked
// server-side in every action via requireOfficer(); this is just the first door.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname.startsWith('/admin/login');
  if (!user && !isLogin) {
    return NextResponse.redirect(new URL('/admin/login', request.url));
  }
  return response;
}

export const config = { matcher: ['/admin/:path*'] };
