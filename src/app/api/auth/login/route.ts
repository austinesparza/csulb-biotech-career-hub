import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '@/lib/auth-request';
import { createServerAuthClient } from '@/lib/supabase/server';

function loginPage(request: NextRequest, error: string) {
  const target = new URL('/admin/login', request.nextUrl.origin);
  target.searchParams.set('error', error);
  return privateRedirect(target);
}

export async function POST(request: NextRequest) {
  if (!isTrustedFormPost(request)) {
    return loginPage(request, 'invalid');
  }

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');

  if (!/^\S+@\S+\.\S+$/.test(email) || !password) {
    return loginPage(request, 'invalid');
  }

  try {
    const supabase = await createServerAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      return loginPage(request, 'credentials');
    }

    const { data: officer, error: officerError } = await supabase
      .from('officers')
      .select('user_id')
      .eq('user_id', data.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (officerError || !officer) {
      await supabase.auth.signOut();
      if (officerError) {
        console.error('[auth/login] officer check failed', {
          code: officerError.code,
          message: officerError.message,
        });
      }
      return loginPage(request, officerError ? 'unavailable' : 'not_officer');
    }

    return privateRedirect(new URL('/admin', request.nextUrl.origin));
  } catch (error) {
    console.error('[auth/login] request failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return loginPage(request, 'unavailable');
  }
}
