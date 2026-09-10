import Link from 'next/link';

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const errors: Record<string, string> = {
  invalid: 'Enter a valid email address and password.',
  credentials: 'The email or password was not accepted.',
  not_officer: 'This account does not have active officer access.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again.',
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorCode = typeof params.error === 'string' ? params.error : '';
  const error = errors[errorCode];

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Officer sign-in</h1>
      <form method="post" action="/api/auth/login" className="space-y-3">
        <input name="email" type="email" autoComplete="username" required placeholder="Email"
          className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" autoComplete="current-password" required placeholder="Password"
          className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-gray-900 px-4 py-2 text-white">
          Sign in
        </button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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
