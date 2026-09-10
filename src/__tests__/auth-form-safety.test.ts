import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const forgotPasswordPage = readFileSync('src/app/auth/forgot-password/page.tsx', 'utf8');
const loginPage = readFileSync('src/app/admin/login/page.tsx', 'utf8');
const recoveryRoute = readFileSync('src/app/api/auth/recover/route.ts', 'utf8');

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
});
