import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '@/lib/auth-request';

function recoveryPage(request: NextRequest, params: Record<string, string>) {
  const target = new URL('/auth/forgot-password', request.nextUrl.origin);
  Object.entries(params).forEach(([key, value]) => target.searchParams.set(key, value));
  return privateRedirect(target);
}

function publicSiteOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost) return `https://${productionHost}`;

  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  if (!isTrustedFormPost(request)) {
    return recoveryPage(request, { error: 'invalid' });
  }

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return recoveryPage(request, { error: 'invalid' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const redirectTo = new URL('/auth/update-password', publicSiteOrigin(request)).toString();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    console.error('[auth/recovery] request rejected', {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    const rateLimited = error.status === 429 || [
      'over_email_send_rate_limit',
      'over_request_rate_limit',
    ].includes(error.code ?? '');
    return recoveryPage(request, { error: rateLimited ? 'rate_limited' : 'send_failed' });
  }

  return recoveryPage(request, { sent: '1' });
}
