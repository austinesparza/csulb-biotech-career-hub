import { describe, expect, it } from 'vitest';
import { readImplicitMagicLinkSession, readImplicitRecoverySession } from '../lib/recovery-session';

describe('implicit password-recovery callbacks', () => {
  it('extracts only the credentials from a recovery fragment', () => {
    expect(readImplicitRecoverySession(
      '#access_token=access.jwt&refresh_token=refresh-token&type=recovery&expires_in=3600',
    )).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh-token' });
  });

  it.each([
    ['', 'empty fragment'],
    ['?access_token=a&refresh_token=r&type=recovery', 'query parameters'],
    ['#access_token=a&refresh_token=r', 'missing recovery type'],
    ['#access_token=a&refresh_token=r&type=signup', 'non-recovery callback'],
    ['#refresh_token=r&type=recovery', 'missing access token'],
    ['#access_token=a&type=recovery', 'missing refresh token'],
  ])('rejects %s (%s)', (hash) => {
    expect(readImplicitRecoverySession(hash)).toBeNull();
  });

  it('rejects an unreasonably large fragment', () => {
    expect(readImplicitRecoverySession(`#access_token=${'a'.repeat(9_000)}&refresh_token=r&type=recovery`))
      .toBeNull();
  });
});


describe('implicit officer magic-link callbacks', () => {
  it('extracts only magic-link credentials', () => {
    expect(readImplicitMagicLinkSession(
      '#access_token=access.jwt&refresh_token=refresh-token&type=magiclink&expires_in=3600',
    )).toEqual({ accessToken: 'access.jwt', refreshToken: 'refresh-token' });
  });

  it.each([
    ['#access_token=a&refresh_token=r&type=recovery', 'recovery callback'],
    ['#access_token=a&refresh_token=r&type=signup', 'signup callback'],
    ['#access_token=a&refresh_token=r&type=email', 'email-code callback'],
    ['#access_token=a&type=magiclink', 'missing refresh token'],
  ])('rejects %s (%s)', (hash) => {
    expect(readImplicitMagicLinkSession(hash)).toBeNull();
  });
});
