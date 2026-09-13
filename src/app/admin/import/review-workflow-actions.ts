'use server';

import { syncGoogleSheet, type GoogleSheetSyncSummary } from './actions';
import {
  reconcileAndSyncMachineReviewQueueToSheet,
  type ReconciledReviewSheetSyncSummary,
} from './sheet-reconcile-actions';

export interface ReviewWorkflowSyncSummary {
  pulled: GoogleSheetSyncSummary;
  pushed: ReconciledReviewSheetSyncSummary;
}

export type ReviewWorkflowSyncResult =
  | { ok: true; summary: ReviewWorkflowSyncSummary }
  | { ok: false; error: string; completedStage?: 'pull' };

/**
 * Normal officer Sheet workflow: ingest existing officer decisions first, then
 * reconcile and refresh the Review Queue. This prevents a push from obscuring
 * officer edits and removes the need to remember directionality.
 */
export async function syncReviewWorkflow(): Promise<ReviewWorkflowSyncResult> {
  const pull = await syncGoogleSheet();
  if (!pull.ok) return { ok: false, error: pull.error };

  const push = await reconcileAndSyncMachineReviewQueueToSheet();
  if (!push.ok) {
    return {
      ok: false,
      error: `Officer decisions were imported, but the refreshed Review Queue could not be delivered: ${push.error}`,
      completedStage: 'pull',
    };
  }

  return {
    ok: true,
    summary: {
      pulled: pull.summary,
      pushed: push.summary,
    },
  };
}
