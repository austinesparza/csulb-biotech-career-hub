import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '@/lib/auth-request';
import { createServerAuthClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  if (!isTrustedFormPost(request)) {
    return privateRedirect(new URL('/admin', request.nextUrl.origin));
  }

  try {
    const supabase = await createServerAuthClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('[auth/logout] request failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }

  return privateRedirect(new URL('/admin/login', request.nextUrl.origin));
}
