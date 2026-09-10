import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '../lib/security-headers';

describe('content security policy', () => {
  it('uses a request nonce and the configured Supabase origin', () => {
    const csp = buildContentSecurityPolicy({ nonce: 'abc123', supabaseUrl: 'https://project.supabase.co/path' });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("connect-src 'self' https://project.supabase.co");
    expect(csp).not.toContain('YOUR_PROJECT');
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it('allows evaluation only in development', () => {
    expect(buildContentSecurityPolicy({ nonce: 'n', development: true })).toContain("'unsafe-eval'");
  });
});
