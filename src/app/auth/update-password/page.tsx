'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SESSION_CHECK_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error('Recovery session validation timed out')),
      SESSION_CHECK_TIMEOUT_MS,
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

export default function UpdatePasswordPage() {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function establishRecoverySession() {
      try {
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          const { error: exchangeError } = await withTimeout(supabase.auth.exchangeCodeForSession(code));
          if (exchangeError) {
            if (active) setError('This reset link is invalid or expired. Request a new link.');
            return;
          }
          window.history.replaceState({}, '', '/auth/update-password');
        }

        const { data, error: sessionError } = await withTimeout(supabase.auth.getSession());
        if (!active) return;
        if (sessionError || !data.session) {
          setError('This reset link is invalid or expired. Request a new link.');
          return;
        }
        setReady(true);
      } catch {
        if (active) setError('This reset link could not be validated. Request a new link.');
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (active && event === 'PASSWORD_RECOVERY' && session) {
        setError(null);
        setReady(true);
      }
    });
    void establishRecoverySession();

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password'));
    const confirmation = String(form.get('confirmation'));
    if (password.length < 12) {
      setError('Use at least 12 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setComplete(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The password could not be updated.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Choose a new password</h1>
      {complete ? (
        <>
          <p role="status" className="text-sm text-green-700">Your password has been updated.</p>
          <Link className="inline-block rounded bg-gray-900 px-4 py-2 text-white" href="/admin">Open officer dashboard</Link>
        </>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="password">New password</label>
          <input id="password" name="password" type="password" autoComplete="new-password"
            minLength={12} required disabled={!ready || pending} className="w-full rounded border px-3 py-2" />
          <label className="block text-sm font-medium" htmlFor="confirmation">Confirm new password</label>
          <input id="confirmation" name="confirmation" type="password" autoComplete="new-password"
            minLength={12} required disabled={!ready || pending} className="w-full rounded border px-3 py-2" />
          <button disabled={!ready || pending} className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50">
            {pending ? 'Updating…' : ready ? 'Update password' : 'Validating link…'}
          </button>
        </form>
      )}
      {error && <p role="alert" aria-live="polite" className="text-sm text-red-600">{error}</p>}
      {!ready && !complete && <Link className="text-sm underline" href="/auth/forgot-password">Request a new reset link</Link>}
    </div>
  );
}
