'use client';

import { useState, useTransition } from 'react';
import { syncGoogleSheet, type GoogleSheetSyncSummary } from './actions';

export function SheetSync() {
  const [summary, setSummary] = useState<GoogleSheetSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return <section className="space-y-3 rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
    <div>
      <h2 className="font-semibold">Sync the club Google Sheet</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
        Reads the configured intake tab once and sends every row through the same private archive,
        deduplication, and officer-review path as a CSV upload.
      </p>
    </div>
    <button
      type="button"
      disabled={pending}
      className="primary-button disabled:opacity-50"
      onClick={() => {
        setError(null);
        setSummary(null);
        startTransition(async () => {
          try {
            setSummary(await syncGoogleSheet());
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Google Sheet sync failed');
          }
        });
      }}
    >
      {pending ? 'Syncing…' : 'Sync from Google Sheet'}
    </button>
    {error ? <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
    {summary ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">Sync complete</p>
      <p>
        {summary.sheetRows} Sheet rows read · {summary.inserted} new · {summary.updated} refreshed ·{' '}
        {summary.touched} approved records checked · {summary.changeFlags} changes queued ·{' '}
        {summary.errors.length} errors
      </p>
      <p className="mt-1 text-xs">Range: {summary.sheetRange}</p>
      <a href="/admin/review" className="mt-2 inline-block underline">Open review queue →</a>
    </div> : null}
  </section>;
}
