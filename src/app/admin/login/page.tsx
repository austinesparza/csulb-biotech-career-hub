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
    <section className="officer-login-card">
      <div className="officer-login-kicker">Private officer access</div>
      <h1 className="officer-login-title">Officer sign-in</h1>
      <p className="officer-login-deck">
        Use your existing officer account to review opportunities, operate ingestion, and manage approved records.
      </p>

      {linkSent ? (
        <div className="mt-6 space-y-4">
          <p role="status" className="rounded border border-green-700 bg-green-50 px-3 py-2 text-sm text-green-900">
            If that email belongs to an officer account, a sign-in link is on its way. Use only the newest email.
          </p>
          <Link className="block text-sm underline" href="/admin/login">
            Send a link to a different email
          </Link>
        </div>
      ) : (
        <form method="post" action="/api/auth/email-otp/request" className="mt-6 space-y-3">
          <label className="block text-sm font-medium" htmlFor="email">Officer email</label>
          <input id="email" name="email" type="email" autoComplete="username" required placeholder="name@csulb.edu" />
          <button className="officer-login-primary" type="submit">Email me a sign-in link</button>
        </form>
      )}

      {error ? <p role="alert" className="mt-4 text-sm" style={{ color: 'var(--restricted)' }}>{error}</p> : null}

      <details className="officer-login-advanced mt-5">
        <summary>Use password instead</summary>
        <div>
          <form method="post" action="/api/auth/login" className="space-y-3">
            <input name="email" type="email" autoComplete="username" required placeholder="Officer email" />
            <input name="password" type="password" autoComplete="current-password" required placeholder="Password" />
            <button className="officer-login-secondary" type="submit">Sign in with password</button>
            <p className="text-sm">
              <Link className="underline" href="/auth/forgot-password">Forgot your password?</Link>
            </p>
          </form>
        </div>
      </details>

      <p className="officer-login-note mt-5">
        Officer access is allowlisted. There is no public self-signup, and private review data is never exposed on the public Career Hub.
      </p>
    </section>
  );
}
