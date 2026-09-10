import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forgotPasswordPage = readFileSync('src/app/auth/forgot-password/page.tsx', 'utf8');
const loginPage = readFileSync('src/app/admin/login/page.tsx', 'utf8');

describe('authentication form safety', () => {
  it('never falls back to a GET that places credentials in the URL', () => {
    expect(loginPage).toContain('method="post"');
    expect(forgotPasswordPage).toContain('method="post"');
  });

  it('keeps password recovery disabled until its client handler is ready', () => {
    expect(forgotPasswordPage).toContain('disabled={!ready || pending}');
    expect(forgotPasswordPage).toContain('window.setTimeout(() => setReady(true), 0)');
  });
});
