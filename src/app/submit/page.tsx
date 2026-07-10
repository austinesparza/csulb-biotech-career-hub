'use client';
// Public submission form (Issue 14). Inserts into user_submissions via the
// anon key, which RLS restricts to INSERT only; submissions are never
// readable publicly and never publish anything directly.
import { useState } from 'react';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import { createClient } from '@/lib/supabase/client';

const inputStyle = { border: '1px solid var(--line)' } as const;

export default function SubmitPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Honeypot: real users never see or fill this field.
    if (String(fd.get('website') ?? '').trim() !== '') { setDone(true); return; }

    const url = String(fd.get('url') ?? '').trim();
    if (!/^https?:\/\//i.test(url)) {
      setError('A valid link starting with http(s):// is required.');
      return;
    }
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error: dbError } = await supabase.from('user_submissions').insert({
      submission_type: String(fd.get('type') ?? 'opportunity'),
      payload: {
        url,
        company: String(fd.get('company') ?? '').trim() || null,
        title: String(fd.get('title') ?? '').trim() || null,
        details: String(fd.get('details') ?? '').trim() || null,
      },
      submitter_name: String(fd.get('name') ?? '').trim() || null,
      submitter_email: String(fd.get('email') ?? '').trim() || null,
    });
    setPending(false);
    if (dbError) setError('Could not send right now. Please email us instead.');
    else setDone(true);
  }

  if (done) {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Thanks!</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          An officer will review your submission before anything is published.
          If it checks out, it usually appears on the board within a week.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Submit an opportunity</h1>
      <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
        Found an internship, spotted a broken link, or want to suggest a resource?
        Send it here. An officer verifies everything before it is published.
        Prefer email? Reach the officers at{' '}
        <a href={mailto(CLUB_LINKS.emailSubjectSubmit)} className="underline" style={{ color: 'var(--brand-deep)' }}>
          {CLUB_LINKS.email}
        </a>.
      </p>

      <form onSubmit={onSubmit} className="rounded-xl bg-white p-4 text-sm sm:p-5" style={inputStyle}>
        <label className="block font-medium">
          What are you sending? *
          <select name="type" required defaultValue="opportunity"
            className="mt-1 w-full rounded-md bg-white px-2 py-2 font-normal" style={inputStyle}>
            <option value="opportunity">A new internship or opportunity</option>
            <option value="correction">A correction (broken link, expired posting, wrong details)</option>
            <option value="resource">A career resource worth sharing</option>
          </select>
        </label>
        <label className="mt-3 block font-medium">
          Link *
          <input name="url" type="url" required placeholder="https://" maxLength={500}
            className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
        </label>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <label className="mt-3 block font-medium">
            Company or organization
            <input name="company" maxLength={120}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="mt-3 block font-medium">
            Role title
            <input name="title" maxLength={160}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="mt-3 block font-medium">
            Your name (optional)
            <input name="name" maxLength={80}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="mt-3 block font-medium">
            Your email (optional, in case we have questions)
            <input name="email" type="email" maxLength={120}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
        </div>
        <label className="mt-3 block font-medium">
          Anything else we should know
          <textarea name="details" rows={3} maxLength={1000}
            placeholder="Deadline, eligibility, why it is a good fit for members, or what is wrong with an existing listing."
            className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
        </label>
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}>
          <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        </div>
        <button disabled={pending}
          className="mt-4 rounded-md px-5 py-2 font-medium text-white disabled:opacity-40"
          style={{ background: 'var(--ink)' }}>
          {pending ? 'Sending…' : 'Send to the officers'}
        </button>
        {error && <p className="mt-2 text-red-700">{error}</p>}
      </form>

      <div className="rounded-xl bg-white p-4 text-sm" style={inputStyle}>
        <p className="font-medium">What happens next</p>
        <p className="mt-1" style={{ color: 'var(--ink-soft)' }}>
          An officer verifies the link and details before anything is published.
          Nothing appears on the board without review, and your contact info is
          only visible to officers.
        </p>
      </div>
    </div>
  );
}
