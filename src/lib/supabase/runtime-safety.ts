type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Vercel previews are intentionally read-only. Keeping every privileged key
 * out of that environment prevents a preview branch from writing to either
 * production or an accidentally shared staging project.
 */
export function assertPrivilegedRuntimeAllowed(env: Environment = process.env): void {
  const hasPrivilegedKey = Boolean(
    env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (env.VERCEL_ENV === 'preview' && hasPrivilegedKey) {
    throw new Error(
      'Privileged Supabase credentials must not be configured in Vercel preview deployments.',
    );
  }
}
