'use client';
// Paste-to-prefill quick-add form. Parsing runs locally on pasted text.
import { useRef, useState, useTransition } from 'react';
import { FOCUS_AREAS } from '@/lib/focusAreas';
import { prefillFromText } from '@/lib/prefill';
import { quickAddOpportunity, type QuickAddResult } from './actions';

const inputStyle = { border: '1px solid var(--line)' } as const;

export function QuickAddForm({
  sources,
  defaultSourceId,
}: {
  sources: Array<{ id: string; name: string }>;
  defaultSourceId: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<QuickAddResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (name: string, value: string | null) => {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
    if (el && value && !el.value) el.value = value;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-white p-4" style={inputStyle}>
        <label className="block text-sm font-medium">
          Paste the posting text (optional)
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder="Copy the job posting from your browser, including the link, and paste it here."
            className="mt-1 w-full rounded-md px-3 py-2 text-sm font-normal"
            style={inputStyle}
          />
        </label>
        <button
          type="button"
          disabled={!pasted.trim()}
          onClick={() => {
            const p = prefillFromText(pasted);
            set('company', p.company);
            set('title', p.title);
            set('posting_url', p.posting_url);
            set('location', p.location);
            set('focus_area', p.focus_area);
            set('deadline', p.deadline_text);
            set('start_date_text', p.start_date_text);
            set('application_type', p.application_type);
            set('eligibility', p.eligibility);
            const paidEl = formRef.current?.elements.namedItem('paid_status') as HTMLSelectElement | null;
            if (paidEl && paidEl.value === 'unknown') paidEl.value = p.paid_guess;
          }}
          className="mt-2 rounded-md bg-white px-4 py-1.5 text-sm disabled:opacity-40"
          style={inputStyle}
        >
          Prefill from pasted text
        </button>
      </div>

      <form
        ref={formRef}
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          setError(null);
          startTransition(async () => {
            try {
              setResult(await quickAddOpportunity(fd));
              formRef.current?.reset();
              setPasted('');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Save failed');
            }
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-medium">
            Company *
            <input name="company" required maxLength={120}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="block font-medium">
            Title *
            <input name="title" required maxLength={160}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-medium">
            Posting link
            <input name="posting_url" type="url" placeholder="https://" maxLength={500}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="block font-medium">
            Source *
            <select name="source_record_id" required defaultValue={defaultSourceId}
              className="mt-1 w-full rounded-md bg-white px-2 py-2 font-normal" style={inputStyle}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block font-medium">
            Location
            <input name="location" maxLength={120}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="block font-medium">
            Focus area
            <input name="focus_area" maxLength={80} list="focus-areas"
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
            <datalist id="focus-areas">
              {FOCUS_AREAS.map((f) => <option key={f} value={f} />)}
            </datalist>
          </label>
          <label className="block font-medium">
            Deadline
            <input name="deadline" placeholder="e.g. 3/15/2027 or Rolling" maxLength={80}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="block font-medium">
            Start date or duration
            <input name="start_date_text" maxLength={120}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
          <label className="block font-medium">
            Pay
            <select name="paid_status" defaultValue="unknown"
              className="mt-1 w-full rounded-md bg-white px-2 py-2 font-normal" style={inputStyle}>
              <option value="unknown">Unknown</option>
              <option value="paid">Paid</option>
              <option value="stipend">Stipend</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <label className="block font-medium">
            Application type
            <input name="application_type" placeholder="e.g. Online application" maxLength={120}
              className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
          </label>
        </div>
        <label className="block font-medium">
          Eligibility
          <input name="eligibility" maxLength={200}
            className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
        </label>
        <label className="block font-medium">
          Public notes (what students will see, still reviewed at approval)
          <textarea name="public_notes" rows={2} maxLength={500}
            className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
        </label>
        <label className="block font-medium">
          Private notes (officers only)
          <textarea name="private_notes" rows={2} maxLength={500}
            className="mt-1 w-full rounded-md bg-white px-3 py-2 font-normal" style={inputStyle} />
        </label>
        <button disabled={pending}
          className="rounded-md px-5 py-2 font-medium text-white disabled:opacity-40"
          style={{ background: 'var(--ink)' }}>
          {pending ? 'Saving…' : 'Save to review queue'}
        </button>
      </form>

      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {result && (
        <div className="rounded-xl bg-white p-4 text-sm" style={inputStyle}>
          <p className="font-medium">Saved to the review queue</p>
          {result.duplicateWarning && (
            <p className="mt-1" style={{ color: 'var(--sand-deep)' }}>{result.duplicateWarning}</p>
          )}
          <a href="/admin/review" className="mt-2 inline-block underline" style={{ color: 'var(--brand-deep)' }}>
            Review it now
          </a>
        </div>
      )}
    </div>
  );
}
