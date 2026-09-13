'use client';

import { useState, useTransition } from 'react';
import {
  syncGoogleSheet,
  type GoogleSheetSyncSummary,
} from './actions';
import {
  syncReviewWorkflow,
  type ReviewWorkflowSyncSummary,
} from './review-workflow-actions';
import {
  reconcileAndSyncMachineReviewQueueToSheet,
  type ReconciledReviewSheetSyncSummary,
} from './sheet-reconcile-actions';

export function SheetSync() {
  const [workflowSummary, setWorkflowSummary] = useState<ReviewWorkflowSyncSummary | null>(null);
  const [pullSummary, setPullSummary] = useState<GoogleSheetSyncSummary | null>(null);
  const [pushSummary, setPushSummary] = useState<ReconciledReviewSheetSyncSummary | null>(null);
  const [mode, setMode] = useState<'workflow' | 'pull' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset(nextMode: 'workflow' | 'pull' | 'push') {
    setError(null);
    setWorkflowSummary(null);
    setPullSummary(null);
    setPushSummary(null);
    setMode(nextMode);
  }

  function beginWorkflow() {
    reset('workflow');
    startTransition(async () => {
      try {
        const result = await syncReviewWorkflow();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setWorkflowSummary(result.summary);
      } catch (err) {
        setError(err instanceof Error
          ? err.message
          : 'The review workflow could not reach the server. No record was published.');
      }
    });
  }

  function beginAdvanced(nextMode: 'pull' | 'push') {
    reset(nextMode);
    startTransition(async () => {
      try {
        if (nextMode === 'pull') {
          const result = await syncGoogleSheet();
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setPullSummary(result.summary);
          return;
        }
        const result = await reconcileAndSyncMachineReviewQueueToSheet();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPushSummary(result.summary);
      } catch (err) {
        setError(err instanceof Error
          ? err.message
          : 'The sync request could not reach the server. No record was published.');
      }
    });
  }

  const renderPushSummary = (summary: ReconciledReviewSheetSyncSummary) => <>
    <p>
      {summary.appended} added · {summary.refreshed} system rows refreshed ·{' '}
      {summary.linked} existing rows linked · {summary.alreadyPresent} already present ·{' '}
      {summary.archived} resolved rows moved to Archive
    </p>
    <p className="mt-1 text-xs">
      Backend check: {summary.reconciliation.considered} reviewable source postings checked ·{' '}
      {summary.reconciliation.alreadyMaterialized} already canonical ·{' '}
      {summary.reconciliation.missingMaterialization} bridge gaps found ·{' '}
      {summary.reconciliation.repaired} repaired.
    </p>
    <p className="mt-1 text-xs">
      {summary.totalMachineCandidates > 0
        ? `${summary.totalMachineCandidates} unresolved machine candidates are currently eligible for the Review Queue.`
        : 'No unresolved machine candidates remain. Previously resolved machine rows are retained in the Sheet Archive tab.'}
    </p>
  </>;

  return <section className="space-y-4 rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
    <div>
      <h2 className="font-semibold">Sync the review workflow</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
        One sync imports officer decisions first, archives resolved work, repairs any missing machine-review records,
        and then refreshes the Sheet with current candidates. You no longer need to remember push versus pull order.
      </p>
      <p className="mt-2 text-xs font-medium" style={{ color: 'var(--restricted)' }}>
        Sheet decisions remain private review inputs. Publication still requires an authenticated officer confirmation in the review queue.
      </p>
    </div>

    <button
      type="button"
      disabled={pending}
      className="primary-button w-full disabled:opacity-50"
      onClick={beginWorkflow}
    >
      {pending && mode === 'workflow' ? 'Syncing review workflow…' : 'Sync review workflow'}
    </button>

    <details className="rounded-lg p-3" style={{ background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
      <summary className="cursor-pointer text-sm font-semibold">Advanced one-way controls</summary>
      <p className="mt-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
        Use these only for diagnosis. Normal operation should use the bidirectional sync above.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          className="secondary-button disabled:opacity-50"
          onClick={() => beginAdvanced('pull')}
        >
          {pending && mode === 'pull' ? 'Reading decisions…' : 'Pull decisions only'}
        </button>
        <button
          type="button"
          disabled={pending}
          className="secondary-button disabled:opacity-50"
          onClick={() => beginAdvanced('push')}
        >
          {pending && mode === 'push' ? 'Reconciling and updating…' : 'Refresh Sheet only'}
        </button>
      </div>
    </details>

    {error ? <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

    {workflowSummary ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">Review workflow synchronized</p>
      <p>
        {workflowSummary.pulled.sheetRows} Sheet candidates read · {workflowSummary.pulled.inserted} imported as new ·{' '}
        {workflowSummary.pulled.updated} refreshed · {workflowSummary.pulled.changeFlags} change flags queued
      </p>
      <div className="mt-2">{renderPushSummary(workflowSummary.pushed)}</div>
      <p className="mt-2 text-xs">Officer notes, decisions, and public-safety cells were preserved.</p>
      <a href="/admin/review" className="primary-button mt-3 inline-block">Review private decisions</a>
    </div> : null}

    {pushSummary ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">Review Queue refreshed</p>
      {renderPushSummary(pushSummary)}
    </div> : null}

    {pullSummary ? <div className="rounded bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-semibold">Sheet decisions imported</p>
      <p>
        {pullSummary.sheetRows} candidate rows read · {pullSummary.skippedTemplateRows} unused template rows skipped ·{' '}
        {pullSummary.inserted} new · {pullSummary.updated} refreshed ·{' '}
        {pullSummary.touched} approved records checked · {pullSummary.changeFlags} changes queued ·{' '}
        {pullSummary.errors.length} errors
      </p>
      <a href="/admin/review" className="primary-button mt-3 inline-block">Review private decisions</a>
    </div> : null}
  </section>;
}
