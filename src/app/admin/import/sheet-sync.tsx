'use client';

import { useState, useTransition } from 'react';
import {
  syncGoogleSheet,
  type GoogleSheetSyncSummary,
} from './actions';
import {
  reconcileAndSyncMachineReviewQueueToSheet,
  type ReconciledReviewSheetSyncSummary,
} from './sheet-reconcile-actions';

export function SheetSync() {
  const [pullSummary, setPullSummary] = useState<GoogleSheetSyncSummary | null>(null);
  const [pushSummary, setPushSummary] = useState<ReconciledReviewSheetSyncSummary | null>(null);
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
          const result = await syncGoogleSheet();
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setPullSummary(result.summary);
        } else {
          const result = await reconcileAndSyncMachineReviewQueueToSheet();
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setPushSummary(result.summary);
        }
      } catch (err) {
        setError(err instanceof Error
          ? err.message
          : 'The sync request could not reach the server. No record was published.');
      }
    });
  }

  return <section className="space-y-4 rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
    <div>
      <h2 className="font-semibold">Sync the club Google Sheet</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
        Reconcile machine discoveries into the Review Queue, then pull officer decisions
        and corrections through the private archive and deduplication path.
      </p>
      <p className="mt-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
        The push now checks the stored source backlog first and repairs reviewable postings that are missing their own opportunity record.
        It does not search employers. Run enabled sources from <a className="underline" href="/admin/sources">Automated sources</a>, or wait for the daily source schedule, to discover new postings.
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
        {pending && mode === 'push' ? 'Reconciling and updating…' : 'Reconcile + sync discoveries'}
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
      <p className="font-semibold">Review Queue reconciled</p>
      <p>
        {pushSummary.appended} added · {pushSummary.refreshed} system rows refreshed ·{' '}
        {pushSummary.linked} existing rows linked · {pushSummary.alreadyPresent} already present ·{' '}
        {pushSummary.archived} resolved rows moved to Archive
      </p>
      <p className="mt-1 text-xs">
        Backend check: {pushSummary.reconciliation.considered} reviewable source postings checked ·{' '}
        {pushSummary.reconciliation.alreadyMaterialized} already had a canonical opportunity ·{' '}
        {pushSummary.reconciliation.missingMaterialization} bridge gaps found ·{' '}
        {pushSummary.reconciliation.repaired} repaired.
      </p>
      <p className="mt-1 text-xs">
        {pushSummary.totalMachineCandidates > 0
          ? `${pushSummary.totalMachineCandidates} unresolved machine candidates are currently eligible for the Review Queue.`
          : 'No unresolved machine candidates remain. Previously resolved machine rows are retained in the Sheet Archive tab.'}
        {' '}Officer notes, decisions, and public-safety cells were preserved.
      </p>
      {pushSummary.reconciliation.skippedMissingVersion > 0 || pushSummary.reconciliation.errors.length > 0 ? <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
        Reconciliation needs attention: {pushSummary.reconciliation.skippedMissingVersion} postings lacked a stored version and{' '}
        {pushSummary.reconciliation.errors.length} repair attempts failed. No record was published automatically.
      </p> : null}
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
