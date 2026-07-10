'use client';
// Guardrailed review cards. Approve is disabled until the officer has
// (1) opened or explicitly confirmed the posting link and (2) confirmed the
// public notes are safe. Server actions re-verify officer auth regardless.
import { useState, useTransition } from 'react';
import { approveOpportunity, rejectOpportunity } from './actions';
import type { PaidStatus } from '@/lib/types';

export interface ReviewRow {
  id: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  start_date_text: string | null;
  paid_status: PaidStatus;
  application_type: string | null;
  source_status_raw: string | null;
  public_notes: string | null;
  private_notes: string | null;
  relevance_score: number | null;
  relevance_reasons: string[];
  companies: { name: string; public_safe: boolean } | null;
}

export function ReviewList({ rows }: { rows: ReviewRow[] }) {
  if (rows.length === 0) {
    return <p style={{ color: 'var(--ink-soft)' }}>Queue is clear. Import a CSV or check back after the next submission.</p>;
  }
  return (
    <ul className="space-y-4">
      {rows.map((row) => <ReviewCard key={row.id} row={row} />)}
    </ul>
  );
}

function ReviewCard({ row }: { row: ReviewRow }) {
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const [notesConfirmed, setNotesConfirmed] = useState(false);
  const [status, setStatus] = useState<'open_verified' | 'open_unverified'>('open_verified');
  const [publicNotes, setPublicNotes] = useState(row.public_notes ?? '');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canApprove = (linkConfirmed || !row.posting_url) && notesConfirmed && !pending;

  if (done) {
    return (
      <li className="rounded-xl bg-white p-4 text-sm" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
        <span className="font-medium" style={{ color: 'var(--ink)' }}>{row.title}</span> · {done}
      </li>
    );
  }

  const meta = [
    row.location, row.focus_area, row.eligibility,
    row.deadline ? `deadline ${row.deadline}` : row.deadline_text,
    row.start_date_text, row.paid_status, row.application_type,
  ].filter(Boolean).join(' · ');

  return (
    <li className="rounded-xl bg-white p-4 sm:p-5" style={{ border: '1px solid var(--line)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {row.title}{' '}
          <span className="font-normal" style={{ color: 'var(--ink-soft)' }}>
            · {row.companies?.name ?? 'Unknown company'}
          </span>
        </h2>
        {row.relevance_score != null && (
          <details className="text-xs">
            <summary className="cursor-pointer rounded-full bg-teal-50 px-2.5 py-0.5 font-medium text-teal-900">
              score {row.relevance_score}
            </summary>
            <ul className="mt-1 space-y-0.5" style={{ color: 'var(--ink-soft)' }}>
              {row.relevance_reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </details>
        )}
      </div>

      <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>{meta}</p>
      {row.source_status_raw && (
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-soft)' }}>
          Spreadsheet status column: "{row.source_status_raw}"
        </p>
      )}

      {row.private_notes && (
        <div className="mt-3 rounded-md px-3 py-2 text-sm" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
          <span className="text-xs font-medium" style={{ color: 'var(--ink-soft)' }}>
            Private note (imported), never shown to students:
          </span>{' '}
          {row.private_notes}
        </div>
      )}

      <label className="mt-3 block text-xs font-medium" style={{ color: 'var(--ink-soft)' }}>
        Public notes (what students will see)
        <textarea
          value={publicNotes}
          onChange={(e) => setPublicNotes(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Optional. Keep it factual and student-safe."
          className="mt-1 w-full rounded-md bg-white px-3 py-2 text-sm font-normal"
          style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
        />
      </label>

      <div className="mt-3 space-y-1.5 text-sm">
        {row.posting_url ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={linkConfirmed} onChange={(e) => setLinkConfirmed(e.target.checked)} />
            <span>
              I opened{' '}
              <a href={row.posting_url} target="_blank" rel="noopener noreferrer nofollow"
                className="underline" style={{ color: 'var(--brand-deep)' }}
                onClick={() => setLinkConfirmed(true)}>
                the posting link <span aria-hidden="true">↗</span>
              </a>{' '}
              and it matches this record
            </span>
          </label>
        ) : (
          <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>No posting link. Approve only if details were confirmed another way.</p>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notesConfirmed} onChange={(e) => setNotesConfirmed(e.target.checked)} />
          <span>Public notes contain no private information</span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
          className="rounded-md bg-white px-2 py-1.5" style={{ border: '1px solid var(--line)' }}>
          <option value="open_verified">Publish as verified</option>
          <option value="open_unverified">Publish as not yet re-verified</option>
        </select>
        <button
          disabled={!canApprove}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await approveOpportunity({
                  id: row.id,
                  status,
                  publicNotes,
                  makeCompanyPublic: !(row.companies?.public_safe ?? false),
                });
                setDone('approved and published');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Approve failed');
              }
            });
          }}
          className="rounded-md px-4 py-1.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--ink)' }}
        >
          {pending ? 'Publishing…' : 'Approve'}
        </button>
        <button
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await rejectOpportunity(row.id, 'not_relevant');
                setDone('rejected as not relevant');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Reject failed');
              }
            });
          }}
          className="rounded-md bg-white px-4 py-1.5 disabled:opacity-40"
          style={{ border: '1px solid var(--line)' }}
        >
          Not relevant
        </button>
        <button
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await rejectOpportunity(row.id, 'hidden');
                setDone('hidden');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Hide failed');
              }
            });
          }}
          className="rounded-md bg-white px-4 py-1.5 disabled:opacity-40"
          style={{ border: '1px solid var(--line)' }}
        >
          Hide
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
