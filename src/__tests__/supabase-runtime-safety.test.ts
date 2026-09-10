import { describe, expect, it } from 'vitest';
import { assertPrivilegedRuntimeAllowed } from '../lib/supabase/runtime-safety';

describe('privileged Supabase runtime safety', () => {
  it('rejects every privileged key in a Vercel preview', () => {
    expect(() => assertPrivilegedRuntimeAllowed({
      VERCEL_ENV: 'preview',
      SUPABASE_SECRET_KEY: 'server-secret',
    })).toThrow(/must not be configured/);

    expect(() => assertPrivilegedRuntimeAllowed({
      VERCEL_ENV: 'preview',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-server-secret',
    })).toThrow(/must not be configured/);
  });

  it('allows an unprivileged preview and a privileged production runtime', () => {
    expect(() => assertPrivilegedRuntimeAllowed({ VERCEL_ENV: 'preview' })).not.toThrow();
    expect(() => assertPrivilegedRuntimeAllowed({
      VERCEL_ENV: 'production',
      SUPABASE_SECRET_KEY: 'server-secret',
    })).not.toThrow();
  });
});
