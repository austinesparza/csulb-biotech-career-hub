import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forgotPasswordPage = readFileSync('src/app/auth/forgot-password/page.tsx', 'utf8');
const updatePasswordPage = readFileSync('src/app/auth/update-password/page.tsx', 'utf8');
const loginPage = readFileSync('src/app/admin/login/page.tsx', 'utf8');
const recoveryRoute = readFileSync('src/app/api/auth/recover/route.ts', 'utf8');
const loginRoute = readFileSync('src/app/api/auth/login/route.ts', 'utf8');
const emailOtpRequestRoute = readFileSync('src/app/api/auth/email-otp/request/route.ts', 'utf8');
const emailLinkPage = readFileSync('src/app/auth/email-link/page.tsx', 'utf8');
const logoutRoute = readFileSync('src/app/api/auth/logout/route.ts', 'utf8');
const adminPage = readFileSync('src/app/admin/page.tsx', 'utf8');
const authRequest = readFileSync('src/lib/auth-request.ts', 'utf8');
const proxy = readFileSync('src/proxy.ts', 'utf8');

describe('authentication form safety', () => {
  it('never falls back to a GET that places credentials in the URL', () => {
    expect(loginPage).toContain('method="post"');
    expect(forgotPasswordPage).toContain('method="post"');
  });

  it('provides a server POST fallback that works without client hydration', () => {
    expect(forgotPasswordPage).toContain('action="/api/auth/recover"');
    expect(forgotPasswordPage).not.toContain("'use client'");
    expect(recoveryRoute).toContain('export async function POST');
    expect(recoveryRoute).toContain('resetPasswordForEmail');
    expect(recoveryRoute).not.toMatch(/SERVICE_ROLE|SUPABASE_SECRET_KEY/);
  });

  it('distinguishes recovery rate limits without encouraging repeated requests', () => {
    expect(recoveryRoute).toContain("error.status === 429");
    expect(recoveryRoute).toContain("'over_email_send_rate_limit'");
    expect(recoveryRoute).toContain("error: rateLimited ? 'rate_limited' : 'send_failed'");
    expect(forgotPasswordPage).toContain("error === 'rate_limited'");
    expect(forgotPasswordPage).toContain('Wait about one hour');
    expect(forgotPasswordPage).toContain('use only the newest email');
  });

  it('fails closed when a recovery session cannot be established promptly', () => {
    expect(updatePasswordPage).toContain('SESSION_CHECK_TIMEOUT_MS');
    expect(updatePasswordPage).toContain('Recovery session validation timed out');
    expect(updatePasswordPage).toContain('This reset link could not be validated');
    expect(updatePasswordPage).toContain('Request a new reset link');
    expect(updatePasswordPage).toContain('Reset link unavailable');
  });

  it('accepts implicit recovery links without leaving tokens in the address bar', () => {
    expect(updatePasswordPage).toContain('readImplicitRecoverySession(window.location.hash)');
    expect(updatePasswordPage).toContain('supabase.auth.setSession');
    expect(updatePasswordPage).toContain("'/auth/update-password'");
    expect(updatePasswordPage).not.toContain('console.log');
  });

  it('signs officers in through a server POST and checks the officer allowlist', () => {
    expect(loginPage).toContain('action="/api/auth/login"');
    expect(loginPage).not.toContain("'use client'");
    expect(loginRoute).toContain('export async function POST');
    expect(loginRoute).toContain('signInWithPassword');
    expect(loginRoute).toContain(".from('officers')");
    expect(loginRoute).toContain(".eq('is_active', true)");
    expect(loginRoute).not.toMatch(/SERVICE_ROLE|SUPABASE_SECRET_KEY/);
  });

  it('uses the hosted passwordless email link as the primary officer sign-in', () => {
    expect(loginPage).toContain('action="/api/auth/email-otp/request"');
    expect(loginPage).toContain('Email me a sign-in link');
    expect(emailOtpRequestRoute).toContain('signInWithOtp');
    expect(emailOtpRequestRoute).toContain('shouldCreateUser: false');
    expect(emailOtpRequestRoute).toContain('emailRedirectTo');
    expect(emailOtpRequestRoute).toContain("new URL('/auth/email-link'");
    expect(emailOtpRequestRoute).not.toMatch(/SERVICE_ROLE|SUPABASE_SECRET_KEY/);
    expect(emailLinkPage).toContain('readImplicitMagicLinkSession(window.location.hash)');
    expect(emailLinkPage).toContain('supabase.auth.setSession');
    expect(emailLinkPage).toContain(".from('officers')");
    expect(emailLinkPage).toContain(".eq('is_active', true)");
    expect(emailLinkPage).toContain('await supabase.auth.signOut()');
    expect(emailLinkPage).toContain("'/auth/email-link'");
  });

  it('keeps email-link requests same-origin and resistant to account enumeration', () => {
    expect(emailOtpRequestRoute).toContain('isTrustedFormPost(request)');
    expect(emailOtpRequestRoute).toContain("loginPage(request, { sent: '1' })");
    expect(emailOtpRequestRoute).toContain('never reveals whether an email');
    expect(emailOtpRequestRoute).toContain("error: 'rate_limited'");
    expect(loginPage).toContain('If that email belongs to an officer account');
  });

  it('provides a POST-only server sign-out control', () => {
    expect(adminPage).toContain('action="/api/auth/logout"');
    expect(adminPage).toContain('method="post"');
    expect(logoutRoute).toContain('export async function POST');
    expect(logoutRoute).not.toContain('export async function GET');
    expect(logoutRoute).toContain('auth.signOut');
    expect(logoutRoute).not.toMatch(/SERVICE_ROLE|SUPABASE_SECRET_KEY/);
  });

  it('rejects cross-site form posts and prevents auth response caching', () => {
    expect(loginRoute).toContain('isTrustedFormPost(request)');
    expect(logoutRoute).toContain('isTrustedFormPost(request)');
    expect(recoveryRoute).toContain('isTrustedFormPost(request)');
    expect(emailOtpRequestRoute).toContain('isTrustedFormPost(request)');
    expect(authRequest).toContain("request.headers.get('origin')");
    expect(authRequest).toContain("request.headers.get('sec-fetch-site')");
    expect(authRequest).toContain("'Cache-Control', 'private, no-store'");
  });

  it('redirects authenticated non-officers before rendering protected pages', () => {
    expect(proxy).toContain("supabase.rpc('is_officer')");
    expect(proxy).toContain("target.searchParams.set('error'");
    expect(proxy).toContain('await supabase.auth.signOut()');
    expect(proxy).toContain("target.headers.set('Cache-Control', 'private, no-store')");
  });
});
