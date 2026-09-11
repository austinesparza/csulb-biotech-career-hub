import Link from 'next/link';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const errors: Record<string, string> = {
  invalid: 'Enter a valid email address.',
  credentials: 'The email or password was not accepted.',
  not_officer: 'This account does not have active officer access.',
  rate_limited: 'A sign-in email was requested recently. Wait at least one minute before requesting another.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again.',
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorCode = typeof params.error === 'string' ? params.error : '';
  const error = errors[errorCode];
  const linkSent = params.sent === '1';

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Officer sign-in</h1>
      <p className="text-sm text-gray-600">
        Enter your existing officer email. We will send a secure, one-time sign-in link.
      </p>

      {linkSent ? (
        <div className="space-y-3">
          <p role="status" className="rounded border border-green-700 bg-green-50 px-3 py-2 text-sm text-green-900">
            If that email belongs to an officer account, a sign-in link is on its way.
            Use only the newest email.
          </p>
          <Link className="block text-center text-sm underline" href="/admin/login">
            Send a link to a different email
          </Link>
        </div>
      ) : (
        <form method="post" action="/api/auth/email-otp/request" className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="email">Officer email</label>
          <input id="email" name="email" type="email" autoComplete="username" required
            placeholder="Email" className="w-full rounded border px-3 py-2" />
          <button className="w-full rounded bg-gray-900 px-4 py-2 text-white">
            Email me a sign-in link
          </button>
        </form>
      )}

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <details className="rounded border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Use password instead</summary>
        <form method="post" action="/api/auth/login" className="mt-3 space-y-3">
          <input name="email" type="email" autoComplete="username" required placeholder="Email"
            className="w-full rounded border px-3 py-2" />
          <input name="password" type="password" autoComplete="current-password" required placeholder="Password"
            className="w-full rounded border px-3 py-2" />
          <button className="w-full rounded border border-gray-900 px-4 py-2">
            Sign in with password
          </button>
          <p className="text-sm">
            <Link className="underline" href="/auth/forgot-password">Forgot your password?</Link>
          </p>
        </form>
      </details>
      <p className="text-xs text-gray-500">
        Accounts are created by the webmaster in the Supabase dashboard and added to the
        officers allowlist. There is no self-signup.
      </p>
    </div>
  );
}
