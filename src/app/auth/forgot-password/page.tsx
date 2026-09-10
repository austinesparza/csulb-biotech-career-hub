'use client';

import Link from 'next/link';
import { FormEvent, useState, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';

const subscribeToHydration = () => () => {};

export default function ForgotPasswordPage() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setError(null);

    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get('email'));
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (resetError) throw resetError;
      setMessage('Check your email for a password-reset link. The link expires, so use the newest message.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reset email could not be sent.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Reset officer password</h1>
      <p className="text-sm text-gray-600">Enter the email address assigned to your officer account.</p>
      <form method="post" onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          disabled={!ready || pending}
          className="w-full rounded border px-3 py-2" />
        <button disabled={!ready || pending} className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50">
          {pending ? 'Sending…' : ready ? 'Send reset link' : 'Loading secure form…'}
        </button>
      </form>
      {message && <p role="status" aria-live="polite" className="text-sm text-green-700">{message}</p>}
      {error && <p role="alert" aria-live="polite" className="text-sm text-red-600">{error}</p>}
      <Link className="text-sm underline" href="/admin/login">Return to officer sign-in</Link>
    </div>
  );
}
