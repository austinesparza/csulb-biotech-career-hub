'use server';

import { revalidatePath } from 'next/cache';

import { runPipelineCycle } from '@/lib/pipeline-cycle';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export interface PipelineRunActionState {
  status: 'idle' | 'success' | 'warning' | 'error';
  message: string;
  cycleId?: string | null;
  scheduled?: number;
  recovered?: number;
  claimed?: number;
  completed?: number;
  partial?: number;
  failed?: number;
  recordsSeen?: number;
  repaired?: number;
  sheetAdded?: number;
  stageErrors?: number;
}

export const initialPipelineRunActionState: PipelineRunActionState = {
  status: 'idle',
  message: '',
};

export async function runFullPipelineNow(
  _previousState: PipelineRunActionState,
): Promise<PipelineRunActionState> {
  try {
    await requireOfficer();
    const db = createServiceClient();
    const report = await runPipelineCycle({
      db,
      storage: db.storage,
      trigger: 'officer',
    });

    revalidatePath('/admin');
    revalidatePath('/admin/sources');
    revalidatePath('/admin/import');
    revalidatePath('/admin/review');

    const repaired = report.reconciliation.status === 'completed' ? report.reconciliation.repaired : 0;
    const sheetAdded = report.sheetSync.status === 'completed' ? report.sheetSync.appended : 0;
    const stateStatus = report.status === 'completed'
      ? 'success'
      : report.status === 'partial'
        ? 'warning'
        : 'error';

    return {
      status: stateStatus,
      message: report.status === 'completed'
        ? 'Pipeline cycle completed. Due sources, review materialization, and Sheet delivery are synchronized.'
        : report.status === 'partial'
          ? 'Pipeline cycle preserved completed work, but one or more stages need attention. See the counts below and Integration status.'
          : 'Pipeline cycle could not complete its core work. Nothing was published automatically.',
      cycleId: report.cycleId,
      scheduled: report.scheduled,
      recovered: report.recovered,
      claimed: report.claimed,
      completed: report.completed,
      partial: report.partial,
      failed: report.failed,
      recordsSeen: report.recordsSeen,
      repaired,
      sheetAdded,
      stageErrors: report.errors.length,
    };
  } catch (error) {
    console.error('[pipeline-cycle] officer run failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return {
      status: 'error',
      message: 'The pipeline could not start. No opportunity was published. Check Integration status and retry.',
    };
  }
}
