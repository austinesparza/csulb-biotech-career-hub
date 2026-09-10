export function buildContentSecurityPolicy(input: {
  nonce: string;
  supabaseUrl?: string;
  development?: boolean;
}): string {
  let supabaseOrigin = '';
  try {
    supabaseOrigin = input.supabaseUrl ? new URL(input.supabaseUrl).origin : '';
  } catch {
    supabaseOrigin = '';
  }
  const scripts = [`'self'`, `'nonce-${input.nonce}'`, `'strict-dynamic'`];
  if (input.development) scripts.push(`'unsafe-eval'`);
  return [
    `default-src 'self'`,
    `script-src ${scripts.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    `form-action 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`,
    ...(input.development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export function securityHeaders(csp: string): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
