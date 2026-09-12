'use client';

import { useState, useTransition } from 'react';
import {
  syncGoogleSheet,
  syncMachineReviewQueueToSheet,
  type GoogleSheetSyncSummary,
} from './actions';
import type { ReviewSheetSyncSummary } from '@/lib/review-sheet-sync';

export function SheetSync() {
  const [pullSummary, setPullSummary] = useState<GoogleSheetSyncSummary | null>(null);
  const [pushSummary, setPushSummary] = useState<ReviewSheetSyncSummary | null>(null);
  const [mode, setMode] = useState<'pull' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function begin(nextMode: 'pull' | 'push') {
    setError(null);
    setPullSummary(null);
    setPushSummary(null);
    setMode(nextMode);
    startTransition(async () => {
      try {
        if (nextMode === 'pull') {
          setPullSummary(await syncGoogleSheet());
        } else {
          setPushSummary(await syncMachineReviewQueueToSheet());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Google Sheet sync failed');
      }
    });
  }

  return <section className="space-y-4 rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
    <div>
      <h2 className="font-semibold">Sync the club Google Sheet</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
        Move machine discoveries into the Review Queue, then pull officer decisions
        and corrections through the private archive and deduplication path.
      </p>
      <p className="mt-2 text-xs font-medium" style={{ color: 'var(--restricted)' }}>
        Neither direction publishes automatically. Publication still requires an authenticated officer confirmation.
      </p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2">
      <button
        type="button"
        disabled={pending}
        className="primary-button disabled:opacity-50"
        onClick={() => begin('push')}
      >
        {pending && mode === 'push' ? 'Updating Sheet…' : 'Push discoveries to Sheet'}
      </button>
      <button
        type="button"
        disabled={pending}
        className="secondary-button disabled:opacity-50"
        onClick={() => begin('pull')}
      >
        {pending && mode === 'pull' ? 'Reading decisions…' : 'Pull decisions from Sheet'}
      </button>
    </div>

    {error ? <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

    {pushSummary ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">Review Queue updated</p>
      <p>
        {pushSummary.appended} added · {pushSummary.refreshed} system rows refreshed ·{' '}
        {pushSummary.linked} existing rows linked · {pushSummary.alreadyPresent} already present ·{' '}
        {pushSummary.archived} resolved rows moved to Archive
      </p>
      <p className="mt-1 text-xs">
        {pushSummary.totalMachineCandidates} machine candidates considered. Officer notes,
        decisions, and public-safety cells were preserved.
      </p>
    </div> : null}

    {pullSummary ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">Sheet decisions archived</p>
      <p>
        {pullSummary.sheetRows} candidate rows read · {pullSummary.skippedTemplateRows} unused template rows skipped ·{' '}
        {pullSummary.inserted} new · {pullSummary.updated} refreshed ·{' '}
        {pullSummary.touched} approved records checked · {pullSummary.changeFlags} changes queued ·{' '}
        {pullSummary.errors.length} errors
      </p>
      <p className="mt-1 text-xs">Range: {pullSummary.sheetRange}</p>
      <a href="/admin/review" className="primary-button mt-3 inline-block">Confirm decisions and publish</a>
    </div> : null}
  </section>;
}
