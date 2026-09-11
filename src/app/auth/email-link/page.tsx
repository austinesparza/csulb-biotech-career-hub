'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { readImplicitMagicLinkSession } from '@/lib/recovery-session';
import { createClient } from '@/lib/supabase/client';

const SESSION_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('Email sign-in validation timed out')),
      SESSION_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export default function OfficerEmailLinkPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const implicitSession = readImplicitMagicLinkSession(window.location.hash);
    if (implicitSession) {
      window.history.replaceState(window.history.state, '', '/auth/email-link');
    }

    const supabase = createClient();
    let active = true;

    async function finishSignIn() {
      if (!implicitSession) {
        setError('This sign-in link is invalid or expired. Request a new link.');
        return;
      }

      try {
        const { data, error: sessionError } = await withTimeout(
          supabase.auth.setSession({
            access_token: implicitSession.accessToken,
            refresh_token: implicitSession.refreshToken,
          }),
        );
        if (!active) return;
        if (sessionError || !data.user) {
          setError('This sign-in link is invalid or expired. Request a new link.');
          return;
        }

        const { data: officer, error: officerError } = await withTimeout(
          Promise.resolve(
            supabase
              .from('officers')
              .select('user_id')
              .eq('user_id', data.user.id)
              .eq('is_active', true)
              .maybeSingle(),
          ),
        );
        if (!active) return;
        if (officerError || !officer) {
          await supabase.auth.signOut();
          setError(
            officerError
              ? 'Officer access could not be checked. Try again shortly.'
              : 'This account does not have active officer access.',
          );
          return;
        }

        window.location.replace('/admin');
      } catch {
        if (active) setError('This sign-in link could not be validated. Request a new link.');
      }
    }

    void finishSignIn();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Officer email sign-in</h1>
      {error ? (
        <>
          <p role="alert" aria-live="polite" className="text-sm text-red-600">{error}</p>
          <Link className="inline-block rounded bg-gray-900 px-4 py-2 text-white" href="/admin/login">
            Request a new sign-in link
          </Link>
        </>
      ) : (
        <p role="status" className="text-sm text-gray-600">Validating your sign-in link…</p>
      )}
    </div>
  );
}
