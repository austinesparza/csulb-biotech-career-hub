'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';

import { googleSheetsConfigured } from '@/lib/google-sheets';
import { reconcileReviewableSourcePostings } from '@/lib/ingestion/persistence/reconcile-reviewable';
import { runIngestionBatch } from '@/lib/ingestion/source-runner';
import { syncReviewQueueToGoogleSheet } from '@/lib/review-sheet-sync';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export interface QueueDrainActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
  claimed?: number;
  completed?: number;
  failed?: number;
  repaired?: number;
  sheetAdded?: number;
}

export const initialQueueDrainActionState: QueueDrainActionState = {
  status: 'idle',
  message: '',
};

export async function drainQueuedSourceRuns(
  _previousState: QueueDrainActionState,
): Promise<QueueDrainActionState> {
  try {
    await requireOfficer();
    const db = createServiceClient();
    const reports = await runIngestionBatch({
      db,
      storage: db.storage,
      workerId: `officer-queue:${randomUUID()}`,
      limit: 10,
    });

    const failed = reports.filter((report) => report.status === 'failed');
    const reconciliation = await reconcileReviewableSourcePostings({ db, limit: 100 });
    let sheetAdded = 0;

    if (googleSheetsConfigured()) {
      const sheet = await syncReviewQueueToGoogleSheet({ db, limit: 50 });
      sheetAdded = sheet.appended;
    }

    revalidatePath('/admin/sources');
    revalidatePath('/admin/import');
    revalidatePath('/admin/review');

    if (reports.length === 0) {
      return {
        status: 'success',
        message: 'No queued source runs were waiting to be claimed. The review backlog was still reconciled.',
        claimed: 0,
        completed: 0,
        failed: 0,
        repaired: reconciliation.repaired,
        sheetAdded,
      };
    }

    return {
      status: failed.length > 0 ? 'error' : 'success',
      message: failed.length > 0
        ? `${reports.length} queued runs were claimed; ${failed.length} failed. Completed runs and repairable review records were preserved.`
        : `${reports.length} queued source runs were claimed and processed.`,
      claimed: reports.length,
      completed: reports.length - failed.length,
      failed: failed.length,
      repaired: reconciliation.repaired,
      sheetAdded,
    };
  } catch (error) {
    console.error('[source-queue] manual drain failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return {
      status: 'error',
      message: 'Queued source runs could not be processed. Nothing was published automatically. Check integration status and runtime logs.',
    };
  }
}
