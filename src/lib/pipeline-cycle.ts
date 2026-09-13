import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { googleSheetsConfigured } from './google-sheets';
import { reconcileReviewableSourcePostings, type ReviewableSourceReconciliationSummary } from './ingestion/persistence/reconcile-reviewable';
import type { IngestionStorageClient } from './ingestion/persistence/repository';
import { runIngestionBatch, type SourceRunReport } from './ingestion/source-runner';
import { createBraveSearchProvider } from './pipeline/brave-search';
import { runEmployerDiscoveryBatch, runLaneDiscoveryBatch } from './pipeline/discovery-runner';
import { runExtractionBatch } from './pipeline/extraction-runner';
import { createOpenAiCompatibleExtractionModel } from './pipeline/model-openai';
import { SupabaseExtractionStore } from './pipeline/store-supabase';
import { syncReviewQueueToGoogleSheet, type ReviewSheetSyncSummary } from './review-sheet-sync';

export type PipelineCycleTrigger = 'cron' | 'officer' | 'queue_recovery' | 'sheet_sync';
export type PipelineCycleStatus = 'completed' | 'partial' | 'failed';

export interface PipelineStageError {
  stage: 'recover' | 'schedule' | 'ingestion' | 'reconciliation' | 'discovery' | 'extraction' | 'sheet_sync';
  message: string;
}

export type DiscoveryCycleResult =
  | { status: 'disabled' }
  | { status: 'completed'; employers: number; lanes: number; queries: number; results: number; archived: number; errors: number }
  | { status: 'failed'; error: string };

export type ExtractionCycleResult =
  | { status: 'disabled' }
  | { status: 'completed'; saved: number; evidenceFailures: number; errors: number }
  | { status: 'failed'; error: string };

export type SheetCycleResult =
  | { status: 'disabled' }
  | ({ status: 'completed' } & ReviewSheetSyncSummary)
  | { status: 'failed'; error: string };

export type ReconciliationCycleResult =
  | ({ status: 'completed' } & ReviewableSourceReconciliationSummary)
  | { status: 'failed'; error: string };

export interface PipelineCycleReport {
  cycleId: string | null;
  workerId: string;
  trigger: PipelineCycleTrigger;
  status: PipelineCycleStatus;
  scheduled: number;
  recovered: number;
  claimed: number;
  completed: number;
  failed: number;
  recordsSeen: number;
  recordsArchived: number;
  reviewTasksCreated: number;
  reconciliation: ReconciliationCycleResult;
  discovery: DiscoveryCycleResult;
  extraction: ExtractionCycleResult;
  sheetSync: SheetCycleResult;
  errors: PipelineStageError[];
  reports: SourceRunReport[];
}

export interface RunPipelineCycleOptions {
  db: SupabaseClient;
  storage: IngestionStorageClient;
  trigger: PipelineCycleTrigger;
  workerId?: string;
  scheduleDueSources?: boolean;
  recoverStaleRuns?: boolean;
  runDiscovery?: boolean;
  runExtraction?: boolean;
  syncSheet?: boolean;
  reconcile?: boolean;
  batchLimit?: number;
  sheetSyncLimit?: number;
  staleAfterMinutes?: number;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(value as number, max));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Unknown pipeline error';
}

async function createCycleRecord(params: {
  db: SupabaseClient;
  trigger: PipelineCycleTrigger;
  workerId: string;
}): Promise<string | null> {
  const { data, error } = await params.db.from('pipeline_cycles').insert({
    trigger_kind: params.trigger,
    status: 'running',
    worker_id: params.workerId,
  }).select('id').single();
  if (error || !data) {
    console.error('[pipeline-cycle] could not create observability row', { error: error?.message ?? 'missing row' });
    return null;
  }
  return String(data.id);
}

async function finishCycleRecord(params: {
  db: SupabaseClient;
  report: PipelineCycleReport;
}): Promise<void> {
  if (!params.report.cycleId) return;
  const { report } = params;
  const { error } = await params.db.from('pipeline_cycles').update({
    status: report.status,
    finished_at: new Date().toISOString(),
    scheduled_count: report.scheduled,
    recovered_count: report.recovered,
    claimed_count: report.claimed,
    completed_count: report.completed,
    failed_count: report.failed,
    records_seen: report.recordsSeen,
    records_archived: report.recordsArchived,
    review_tasks_created: report.reviewTasksCreated,
    reconciliation_json: report.reconciliation,
    discovery_json: report.discovery,
    extraction_json: report.extraction,
    sheet_sync_json: report.sheetSync,
    errors_json: report.errors,
  }).eq('id', report.cycleId);
  if (error) console.error('[pipeline-cycle] could not finalize observability row', { cycleId: report.cycleId, error: error.message });
}

/**
 * Canonical private pipeline orchestration.
 *
 * All normal entry points call this function so scheduling, worker recovery,
 * source processing, canonical materialization, and Sheet delivery stay in the
 * same order. None of these stages can approve or publish an opportunity.
 */
export async function runPipelineCycle(options: RunPipelineCycleOptions): Promise<PipelineCycleReport> {
  const requestedBatchLimit = options.batchLimit ?? Number(process.env.PIPELINE_BATCH_LIMIT ?? 5);
  const batchLimit = boundedInteger(requestedBatchLimit, 5, 1, 10);
  const requestedSheetLimit = options.sheetSyncLimit ?? Number(process.env.PIPELINE_SHEET_SYNC_LIMIT ?? 50);
  const sheetSyncLimit = boundedInteger(requestedSheetLimit, 50, 1, 50);
  const staleAfterMinutes = boundedInteger(options.staleAfterMinutes ?? 20, 20, 5, 1440);
  const workerId = options.workerId?.trim() || `${options.trigger}:${randomUUID()}`;
  const errors: PipelineStageError[] = [];
  const reports: SourceRunReport[] = [];
  let scheduled = 0;
  let recovered = 0;

  const cycleId = await createCycleRecord({ db: options.db, trigger: options.trigger, workerId });

  if (options.recoverStaleRuns !== false) {
    try {
      const { data, error } = await options.db.rpc('recover_stale_source_fetch_runs', {
        p_stale_after_minutes: staleAfterMinutes,
        p_limit: batchLimit,
      });
      if (error) throw new Error(error.message);
      recovered = Array.isArray(data) ? data.length : 0;
    } catch (error) {
      errors.push({ stage: 'recover', message: errorMessage(error) });
    }
  }

  if (options.scheduleDueSources !== false) {
    try {
      const { data, error } = await options.db.rpc('schedule_due_source_fetch_runs', { p_limit: batchLimit });
      if (error) throw new Error(error.message);
      scheduled = Array.isArray(data) ? data.length : 0;
    } catch (error) {
      errors.push({ stage: 'schedule', message: errorMessage(error) });
    }
  }

  try {
    reports.push(...await runIngestionBatch({
      db: options.db,
      storage: options.storage,
      workerId,
      limit: batchLimit,
    }));
  } catch (error) {
    errors.push({ stage: 'ingestion', message: errorMessage(error) });
  }

  let reconciliation: ReconciliationCycleResult;
  if (options.reconcile === false) {
    reconciliation = {
      status: 'completed',
      considered: 0,
      alreadyMaterialized: 0,
      missingMaterialization: 0,
      repaired: 0,
      skippedMissingVersion: 0,
      errors: [],
    };
  } else {
    try {
      reconciliation = {
        status: 'completed',
        ...await reconcileReviewableSourcePostings({ db: options.db, limit: 100 }),
      };
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ stage: 'reconciliation', message });
      reconciliation = { status: 'failed', error: message };
    }
  }

  let discovery: DiscoveryCycleResult = { status: 'disabled' };
  const discoveryEnabled = options.runDiscovery ?? process.env.DISCOVERY_SEARCH_ENABLED === 'true';
  if (discoveryEnabled) {
    try {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
      if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is required');
      const provider = createBraveSearchProvider({
        apiKey,
        storageRightsConfirmed: process.env.BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED === 'true',
      });
      const employerReport = await runEmployerDiscoveryBatch({
        db: options.db,
        provider,
        employerLimit: Math.max(1, Math.min(Number(process.env.EMPLOYER_DISCOVERY_BATCH_SIZE ?? 5) || 5, 5)),
        resultsPerQuery: Math.max(1, Math.min(Number(process.env.EMPLOYER_DISCOVERY_RESULTS_PER_QUERY ?? 5) || 5, 10)),
        runId: `${workerId}:employers`,
      });
      const laneReport = await runLaneDiscoveryBatch({
        db: options.db,
        provider,
        laneLimit: Math.max(1, Math.min(Number(process.env.LANE_DISCOVERY_BATCH_SIZE ?? 1) || 1, 2)),
        resultsPerQuery: Math.max(1, Math.min(Number(process.env.EMPLOYER_DISCOVERY_RESULTS_PER_QUERY ?? 5) || 5, 10)),
        runId: `${workerId}:lanes`,
      });
      const discoveryErrors = [...employerReport.errors, ...laneReport.errors];
      discovery = {
        status: 'completed',
        employers: employerReport.employers,
        lanes: laneReport.lanes,
        queries: employerReport.queries + laneReport.queries,
        results: employerReport.results + laneReport.results,
        archived: employerReport.archived + laneReport.archived,
        errors: discoveryErrors.length,
      };
      if (discoveryErrors.length > 0) {
        errors.push({ stage: 'discovery', message: `${discoveryErrors.length} discovery operations reported errors` });
      }
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ stage: 'discovery', message });
      discovery = { status: 'failed', error: message };
    }
  }

  let extraction: ExtractionCycleResult = { status: 'disabled' };
  const extractionEnabled = options.runExtraction ?? process.env.PIPELINE_MODEL_ENABLED === 'true';
  if (extractionEnabled) {
    try {
      const modelName = process.env.PIPELINE_MODEL_NAME?.trim();
      if (!modelName) throw new Error('PIPELINE_MODEL_NAME is required');
      const modelReport = await runExtractionBatch({
        store: new SupabaseExtractionStore(options.db),
        model: createOpenAiCompatibleExtractionModel({
          model: modelName,
          baseUrl: process.env.PIPELINE_MODEL_BASE_URL ?? 'http://127.0.0.1:20128/v1',
          apiKey: process.env.PIPELINE_MODEL_API_KEY,
          allowRemote: process.env.PIPELINE_ALLOW_REMOTE_MODEL === 'true',
        }),
        limit: batchLimit,
      });
      extraction = {
        status: 'completed',
        saved: modelReport.saved,
        evidenceFailures: modelReport.evidenceFailures,
        errors: modelReport.errors.length,
      };
      if (modelReport.errors.length > 0) {
        errors.push({ stage: 'extraction', message: `${modelReport.errors.length} extraction operations reported errors` });
      }
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ stage: 'extraction', message });
      extraction = { status: 'failed', error: message };
    }
  }

  let sheetSync: SheetCycleResult = { status: 'disabled' };
  const sheetEnabled = options.syncSheet ?? googleSheetsConfigured();
  if (sheetEnabled && googleSheetsConfigured()) {
    try {
      sheetSync = {
        status: 'completed',
        ...await syncReviewQueueToGoogleSheet({ db: options.db, limit: sheetSyncLimit }),
      };
    } catch (error) {
      const message = errorMessage(error);
      errors.push({ stage: 'sheet_sync', message });
      sheetSync = { status: 'failed', error: message };
    }
  }

  const failed = reports.filter((report) => report.status === 'failed').length;
  const completed = reports.length - failed;
  const stageFailures = errors.length + failed;
  const status: PipelineCycleStatus = stageFailures === 0
    ? 'completed'
    : reports.length > 0 || scheduled > 0 || recovered > 0 || reconciliation.status === 'completed'
      ? 'partial'
      : 'failed';

  const report: PipelineCycleReport = {
    cycleId,
    workerId,
    trigger: options.trigger,
    status,
    scheduled,
    recovered,
    claimed: reports.length,
    completed,
    failed,
    recordsSeen: reports.reduce((sum, item) => sum + item.recordsSeen, 0),
    recordsArchived: reports.reduce((sum, item) => sum + item.recordsArchived, 0),
    reviewTasksCreated: reports.reduce((sum, item) => sum + item.reviewTasksCreated, 0),
    reconciliation,
    discovery,
    extraction,
    sheetSync,
    errors,
    reports,
  };

  await finishCycleRecord({ db: options.db, report });
  return report;
}
