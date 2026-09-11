export interface ImplicitAuthSession {
  accessToken: string;
  refreshToken: string;
}

const MAX_FRAGMENT_LENGTH = 8_192;

function readImplicitSession(
  hash: string,
  expectedType: 'recovery' | 'magiclink',
): ImplicitAuthSession | null {
  if (!hash.startsWith('#') || hash.length > MAX_FRAGMENT_LENGTH) return null;

  const params = new URLSearchParams(hash.slice(1));
  if (params.get('type') !== expectedType) return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

/**
 * Supabase's legacy/default recovery email can return an implicit session in
 * the URL fragment. @supabase/ssr forces PKCE mode, so its browser client will
 * reject that otherwise-valid callback unless we establish the session
 * explicitly. Only recovery callbacks are accepted here.
 */
export function readImplicitRecoverySession(hash: string): ImplicitAuthSession | null {
  return readImplicitSession(hash, 'recovery');
}

/**
 * The hosted Supabase magic-link template also returns an implicit session.
 * Keep it separate from recovery so a password-reset link can never be treated
 * as a normal officer sign-in link.
 */
export function readImplicitMagicLinkSession(hash: string): ImplicitAuthSession | null {
  return readImplicitSession(hash, 'magiclink');
}
