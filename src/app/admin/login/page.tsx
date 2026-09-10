'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Officer sign-in</h1>
      <form
        method="post"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setPending(true);
            setError(null);
            const form = new FormData(e.currentTarget);
            const supabase = createClient();
            const { error } = await supabase.auth.signInWithPassword({
              email: String(form.get('email')),
              password: String(form.get('password')),
            });
            if (error) setError(error.message);
            else {
              router.push('/admin');
              router.refresh();
            }
          } catch {
            setError('Sign-in could not reach the authentication service. Please try again.');
          } finally {
            setPending(false);
          }
        }}
        className="space-y-3"
      >
        <input name="email" type="email" required placeholder="Email"
          className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" required placeholder="Password"
          className="w-full rounded border px-3 py-2" />
        <button disabled={pending} className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50">
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p role="alert" aria-live="polite" className="text-sm text-red-600">{error}</p>}
      </form>
      <p className="text-sm">
        <Link className="underline" href="/auth/forgot-password">Forgot your password?</Link>
      </p>
      <p className="text-xs text-gray-500">
        Accounts are created by the webmaster in the Supabase dashboard and added to the
        officers allowlist. There is no self-signup.
      </p>
    </div>
  );
}
