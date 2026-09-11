import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '@/lib/auth-request';
import { OFFICER_OTP_EMAIL_COOKIE } from '@/lib/officer-otp';
import { createServerAuthClient } from '@/lib/supabase/server';

function loginPage(request: NextRequest, error: string) {
  const target = new URL('/admin/login', request.nextUrl.origin);
  target.searchParams.set('sent', '1');
  target.searchParams.set('error', error);
  return privateRedirect(target);
}

export async function POST(request: NextRequest) {
  if (!isTrustedFormPost(request)) {
    return loginPage(request, 'invalid_code');
  }

  const form = await request.formData();
  const email = String(request.cookies.get(OFFICER_OTP_EMAIL_COOKIE)?.value ?? '')
    .trim()
    .toLowerCase();
  const token = String(form.get('token') ?? '').replace(/\s+/g, '');
  if (!/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(token)) {
    return loginPage(request, 'invalid_code');
  }

  try {
    const supabase = await createServerAuthClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });
    if (error || !data.user) {
      return loginPage(request, 'invalid_code');
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
        console.error('[auth/email-otp/verify] officer check failed', {
          code: officerError.code,
          message: officerError.message,
        });
      }
      return loginPage(request, officerError ? 'unavailable' : 'not_officer');
    }

    const response = privateRedirect(new URL('/admin', request.nextUrl.origin));
    response.cookies.delete(OFFICER_OTP_EMAIL_COOKIE);
    return response;
  } catch (error) {
    console.error('[auth/email-otp/verify] request failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return loginPage(request, 'unavailable');
  }
}
