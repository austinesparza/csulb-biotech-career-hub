import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '@/lib/auth-request';

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
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return loginPage(request, { error: 'invalid' });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );
    const emailRedirectTo = new URL('/auth/email-link', request.nextUrl.origin).toString();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo,
      },
    });

    if (error) {
      console.error('[auth/email-link/request] request rejected', {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      if (isRateLimited(error.status, error.code)) {
        return loginPage(request, { error: 'rate_limited' });
      }
    }

    // Keep this response generic so the route never reveals whether an email
    // address belongs to an officer or even exists in Supabase Auth.
    return loginPage(request, { sent: '1' });
  } catch (error) {
    console.error('[auth/email-link/request] request failed', {
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return loginPage(request, { error: 'unavailable' });
  }
}
