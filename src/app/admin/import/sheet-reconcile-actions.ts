'use server';

import { revalidatePath } from 'next/cache';
import {
  reconcileReviewableSourcePostings,
  type ReviewableSourceReconciliationSummary,
} from '@/lib/ingestion/persistence/reconcile-reviewable';
import {
  syncReviewQueueToGoogleSheet,
  type ReviewSheetSyncSummary,
} from '@/lib/review-sheet-sync';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export interface ReconciledReviewSheetSyncSummary extends ReviewSheetSyncSummary {
  reconciliation: ReviewableSourceReconciliationSummary;
}

export type ReconciledSheetSyncActionResult =
  | { ok: true; summary: ReconciledReviewSheetSyncSummary }
  | { ok: false; error: string };

/**
 * Self-heal eligible source postings before pushing the private Review Queue.
 * This repairs historical fuzzy/family collapses without publishing anything.
 */
export async function reconcileAndSyncMachineReviewQueueToSheet(): Promise<ReconciledSheetSyncActionResult> {
  try {
    await requireOfficer();
    const db = createServiceClient();
    const reconciliation = await reconcileReviewableSourcePostings({ db });
    const sheetSummary = await syncReviewQueueToGoogleSheet({ db });

    revalidatePath('/admin/import');
    revalidatePath('/admin/review');
    revalidatePath('/admin/sources');

    return {
      ok: true,
      summary: {
        ...sheetSummary,
        reconciliation,
      },
    };
  } catch (error) {
    console.error('[sheet-reconciliation] reconcile-and-sync failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return {
      ok: false,
      error: 'The source backlog could not be reconciled with the Review Queue. Nothing was published. Check the automated-source status and retry.',
    };
  }
}
