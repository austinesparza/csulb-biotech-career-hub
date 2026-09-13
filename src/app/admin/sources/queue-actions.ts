'use server';

import { revalidatePath } from 'next/cache';

import { runPipelineCycle } from '@/lib/pipeline-cycle';
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
    const report = await runPipelineCycle({
      db,
      storage: db.storage,
      trigger: 'queue_recovery',
      scheduleDueSources: false,
      runDiscovery: false,
      runExtraction: false,
      batchLimit: 10,
    });

    revalidatePath('/admin/sources');
    revalidatePath('/admin/import');
    revalidatePath('/admin/review');

    const repaired = report.reconciliation.status === 'completed' ? report.reconciliation.repaired : 0;
    const sheetAdded = report.sheetSync.status === 'completed' ? report.sheetSync.appended : 0;

    if (report.claimed === 0) {
      return {
        status: report.status === 'failed' ? 'error' : 'success',
        message: report.status === 'failed'
          ? 'The queue was empty, but pipeline maintenance reported an error. Check integration status.'
          : 'No queued source runs were waiting. Backlog reconciliation and Sheet delivery still ran.',
        claimed: 0,
        completed: 0,
        failed: 0,
        repaired,
        sheetAdded,
      };
    }

    return {
      status: report.status === 'completed' ? 'success' : 'error',
      message: report.status === 'completed'
        ? `${report.claimed} queued source runs were claimed and processed through the canonical pipeline.`
        : `${report.claimed} queued runs were claimed; ${report.failed} source runs or downstream stages need attention. Completed work was preserved.`,
      claimed: report.claimed,
      completed: report.completed,
      failed: report.failed,
      repaired,
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
