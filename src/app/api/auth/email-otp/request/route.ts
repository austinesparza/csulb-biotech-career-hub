import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '@/lib/auth-request';
import {
  OFFICER_OTP_COOKIE_MAX_AGE_SECONDS,
  OFFICER_OTP_EMAIL_COOKIE,
} from '@/lib/officer-otp';

function loginPage(request: NextRequest, params: Record<string, string>) {
  const target = new URL('/admin/login', request.nextUrl.origin);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  return privateRedirect(target);
}

function isRateLimited(status?: number, code?: string) {
  return status === 429 || [
    'over_email_send_rate_limit',
    'over_request_rate_limit',
  ].includes(code ?? '');
}

export async function POST(request: NextRequest) {
  if (!isTrustedFormPost(request)) {
    return loginPage(request, { error: 'invalid' });
  }

  const form = await request.formData();
  const storedEmail = request.cookies.get(OFFICER_OTP_EMAIL_COOKIE)?.value;
  const email = String(
    form.get('email') ?? storedEmail ?? '',
  ).trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return loginPage(request, { error: 'invalid' });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (error) {
      console.error('[auth/email-otp/request] request rejected', {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      if (isRateLimited(error.status, error.code)) {
        return loginPage(request, {
          error: 'rate_limited',
          ...(storedEmail ? { sent: '1' } : {}),
        });
      }
    }

    // Keep this response generic so the route never reveals whether an email
    // address belongs to an officer or even exists in Supabase Auth.
    const response = loginPage(request, { sent: '1' });
    response.cookies.set({
      name: OFFICER_OTP_EMAIL_COOKIE,
      value: email,
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: OFFICER_OTP_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error('[auth/email-otp/request] request failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return loginPage(request, { error: 'unavailable' });
  }
}
