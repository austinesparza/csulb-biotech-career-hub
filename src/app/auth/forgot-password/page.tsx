import Link from 'next/link';

type ForgotPasswordPageProps = {
  searchParams: Promise<{ sent?: string; error?: string }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const { sent, error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-bold">Reset officer password</h1>
      <p className="text-sm text-gray-600">Enter the email address assigned to your officer account.</p>
      <form method="post" action="/api/auth/recover" className="space-y-3">
        <label className="block text-sm font-medium" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" required
          className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-gray-900 px-4 py-2 text-white">
          Send reset link
        </button>
      </form>
      {sent === '1' && (
        <p role="status" className="text-sm text-green-700">
          If an officer account matches that email, a reset link has been requested. Use the newest message.
        </p>
      )}
      {error === 'invalid' && (
        <p role="alert" className="text-sm text-red-600">Enter a valid email address.</p>
      )}
      {error === 'send_failed' && (
        <p role="alert" className="text-sm text-red-600">
          The authentication service could not accept the request. Do not keep retrying.
          Contact the webmaster if this continues.
        </p>
      )}
      {error === 'rate_limited' && (
        <p role="alert" className="text-sm text-red-600">
          Too many reset emails were requested. Supabase has temporarily paused new messages.
          Wait about one hour, then request one new link and use only the newest email.
        </p>
      )}
      <Link className="text-sm underline" href="/admin/login">Return to officer sign-in</Link>
    </div>
  );
}
