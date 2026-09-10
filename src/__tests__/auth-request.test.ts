import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isTrustedFormPost, privateRedirect } from '../lib/auth-request';

describe('auth request protections', () => {
  it('accepts same-origin form posts', () => {
    const request = new NextRequest('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://example.test', 'sec-fetch-site': 'same-origin' },
    });

    expect(isTrustedFormPost(request)).toBe(true);
  });

  it('rejects cross-origin form posts', () => {
    const request = new NextRequest('https://example.test/api/auth/login', {
      method: 'POST',
      headers: { origin: 'https://attacker.test', 'sec-fetch-site': 'cross-site' },
    });

    expect(isTrustedFormPost(request)).toBe(false);
  });

  it('marks redirects as private and non-cacheable', () => {
    const response = privateRedirect(new URL('https://example.test/admin'));

    expect(response.status).toBe(303);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
