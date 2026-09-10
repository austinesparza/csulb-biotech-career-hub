export interface ImplicitRecoverySession {
  accessToken: string;
  refreshToken: string;
}

const MAX_FRAGMENT_LENGTH = 8_192;

/**
 * Supabase's legacy/default recovery email can return an implicit session in
 * the URL fragment. @supabase/ssr forces PKCE mode, so its browser client will
 * reject that otherwise-valid callback unless we establish the session
 * explicitly. Only recovery callbacks are accepted here.
 */
export function readImplicitRecoverySession(hash: string): ImplicitRecoverySession | null {
  if (!hash.startsWith('#') || hash.length > MAX_FRAGMENT_LENGTH) return null;

  const params = new URLSearchParams(hash.slice(1));
  if (params.get('type') !== 'recovery') return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}
