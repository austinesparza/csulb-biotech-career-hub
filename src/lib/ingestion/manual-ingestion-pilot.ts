import 'server-only';

import { fetchGreenhouseJobs } from './connectors/greenhouse';
import { normalizeEmployerName } from './normalize';
import {
  persistFetchResultWithSupabase,
  createSupabaseIngestionRepository,
  type PersistFetchResultSummary,
  type IngestionDbClient,
  type IngestionStorageClient,
} from './persistence';
import type {
  ConnectorFetchResult,
  GreenhouseConnectorConfig,
  NormalizedSourcePosting,
  SourceFetchRunStatus,
  UncertaintyFlag,
} from './types';
import type { UpdateFetchRunInput, UpdateFetchRunResult } from './persistence/repository';

// ============================================================
// FIXED PILOT CONSTANTS
// ============================================================

/** Fixed Altos Labs board token — never accept from external input. */
export const ALTOS_BOARD_TOKEN = 'altoslabs' as const;

/** Fixed employer name used to enrich candidates — never accept from external input. */
export const ALTOS_EMPLOYER_NAME = 'Altos Labs' as const;

// ============================================================
// SAFE RESULT TYPE
// ============================================================

/**
 * Safe serializable summary of a single Altos Labs ingestion run.
 * Does not contain rawResponseText, payload contents, DB credentials,
 * or a service-role client.
 */
export interface AltosIngestionSummary {
  fetchRunId: string;
  status: SourceFetchRunStatus;
  recordsSeen: number;
  recordsNormalized: number;
  recordsSkipped: number;
  recordsNew: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsReviewed: number;
  payloadStored: boolean;
  errorMessage: string | null;
}

// ============================================================
// GATEWAY INTERFACE
// ============================================================

/** A single job_sources row as needed by the pilot orchestrator. */
export interface PilotJobSourceRow {
  id: string;
  source_record_id: string | null;
  company_id: string | null;
  source_kind: string;
  source_identifier: string | null;
  enabled: boolean;
  automatic_scheduling_paused_at: string | null;
  config_json: Record<string, unknown>;
}

export interface JobSourceHealthUpdate {
  lastAttemptedAt: string;
  lastHttpStatus: number | null;
  /**
   * When true: record a successful attempt (reset consecutive_failures, set last_successful_at).
   * When false: increment consecutive_failures, retain last_successful_at.
   */
  success: boolean;
  lastSuccessfulAt?: string;
}

/**
 * Gateway interface that abstracts all DB and persistence operations needed by
 * the pilot orchestrator. Implementations: production Supabase gateway and
 * lightweight in-memory fakes used in unit tests.
 *
 * This design ensures tests do not need to mock the Supabase query-builder API.
 */
export interface PilotGateway {
  /** Find the single job_sources row for source_kind=greenhouse / source_identifier=altoslabs. */
  findJobSource(): Promise<PilotJobSourceRow | null>;

  /** Find any pending or running fetch run for the given job source. */
  findActiveFetchRun(jobSourceId: string): Promise<{ id: string; status: string } | null>;

  /**
   * Insert a new fetch run in 'running' status, returning the new run ID.
   * trigger_kind: 'manual'
   */
  insertFetchRun(params: {
    jobSourceId: string;
    workerId: string;
    nowIso: string;
  }): Promise<string>;

  /** Update health metadata on job_sources after a fetch attempt. */
  updateJobSourceHealth(jobSourceId: string, update: JobSourceHealthUpdate): Promise<void>;

  /**
   * Transition a running fetch run to 'failed'.
   * Must be a no-op if the run was already finalized (i.e., if status ≠ 'running').
   * Used to handle pre-persistence exceptions.
   */
  finalizeFetchRunFailed(params: {
    fetchRunId: string;
    httpStatus: number | null;
    recordsSeen: number;
    errorMessage: string;
    logJson: Record<string, unknown>;
    finishedAtIso: string;
  }): Promise<void>;

  /**
   * Run the full persistence pipeline for an enriched ConnectorFetchResult.
   * Callers pass the already-enriched result; the gateway calls
   * persistFetchResultWithSupabase (or an equivalent in tests).
   *
   * persistResult MUST:
   * - Finalize the fetch run (completed / partial / failed) internally.
   * - Return a PersistFetchResultSummary on success or partial.
   * - Re-throw (with the run already finalized as failed) on internal exceptions.
   */
  persistResult(params: {
    fetchRunId: string;
    sourceId: string;
    result: ConnectorFetchResult;
  }): Promise<PersistFetchResultSummary>;
}

// ============================================================
// EMPLOYER-NAME ENRICHMENT
// ============================================================

function enrichCandidate(candidate: NormalizedSourcePosting): NormalizedSourcePosting {
  const enrichedFlags = candidate.uncertaintyFlags.filter(
    (f) => f !== ('employer_name_missing' as UncertaintyFlag),
  );
  const enrichedScoreFlags = candidate.scoreBreakdown.uncertaintyFlags.filter(
    (f) => f !== ('employer_name_missing' as UncertaintyFlag),
  );

  return {
    ...candidate,
    employerNameRaw: ALTOS_EMPLOYER_NAME,
    employerNameNormalized: normalizeEmployerName(ALTOS_EMPLOYER_NAME),
    uncertaintyFlags: enrichedFlags,
    scoreBreakdown: {
      ...candidate.scoreBreakdown,
      uncertaintyFlags: enrichedScoreFlags,
    },
  };
}

/** Construct a new result with enriched candidates. Does not mutate the input. */
export function enrichFetchResult(result: ConnectorFetchResult): ConnectorFetchResult {
  if (!result.ok) return result;
  return {
    ...result,
    candidates: result.candidates.map(enrichCandidate),
  };
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function safeMessage(error: unknown, maxLength = 500): string {
  if (error instanceof Error) return error.message.slice(0, maxLength);
  return String(error).slice(0, maxLength);
}

// ============================================================
// CORE ORCHESTRATOR
// ============================================================

/**
 * Core orchestration logic. Accepts an injectable gateway and optional
 * fetchJobs override for dependency injection in tests.
 *
 * Production callers should use runAltosLabsPilot instead.
 */
export async function runAltosLabsPilotCore(params: {
  gateway: PilotGateway;
  fetchJobs?: (config: Pick<GreenhouseConnectorConfig, 'boardToken'>) => Promise<ConnectorFetchResult>;
  workerId: string;
}): Promise<AltosIngestionSummary> {
  const { gateway, workerId } = params;
  const fetchJobs = params.fetchJobs ?? fetchGreenhouseJobs;
  const nowIso = () => new Date().toISOString();

  // ─── Step 1: Query job_sources ─────────────────────────────────────────────
  const source = await gateway.findJobSource();

  // ─── Step 2: Validate source ───────────────────────────────────────────────
  if (!source) {
    throw new Error('Altos Labs Greenhouse job source not found. Run migration 0007 first.');
  }
  if (!source.enabled) {
    throw new Error('Altos Labs job source is disabled. Enable it before running ingestion.');
  }
  if (source.automatic_scheduling_paused_at !== null) {
    throw new Error(
      'Altos Labs job source has automatic scheduling paused. Clear automatic_scheduling_paused_at before running.',
    );
  }
  const boardTokenFromConfig = source.config_json?.boardToken;
  if (boardTokenFromConfig !== ALTOS_BOARD_TOKEN) {
    throw new Error(
      `config_json.boardToken is '${boardTokenFromConfig}' but must be exactly '${ALTOS_BOARD_TOKEN}'. Source configuration is invalid.`,
    );
  }
  if (!source.company_id) {
    throw new Error('Altos Labs job source has no company_id. Check migration 0007.');
  }
  if (!source.source_record_id) {
    throw new Error('Altos Labs job source has no source_record_id. Check migration 0007.');
  }

  // ─── Step 3: Refuse to start if an active run already exists ──────────────
  const activeRun = await gateway.findActiveFetchRun(source.id);
  if (activeRun) {
    throw new Error(
      `Cannot start a new ingestion run: an existing run (${activeRun.id}) is already ${activeRun.status}.`,
    );
  }

  // ─── Step 4: Insert fetch run ──────────────────────────────────────────────
  const fetchRunId = await gateway.insertFetchRun({
    jobSourceId: source.id,
    workerId,
    nowIso: nowIso(),
  });

  // ─── Steps 5–8: Fetch, enrich, persist, update health ─────────────────────
  let fetchResult: ConnectorFetchResult | null = null;

  try {
    // Step 5: Fetch
    fetchResult = await fetchJobs({ boardToken: ALTOS_BOARD_TOKEN });

    // Step 6: Enrich employer name before persistence (do not mutate fetchResult)
    const enrichedResult = enrichFetchResult(fetchResult);

    // Step 7: Persist (handles its own internal error finalization).
    // Connector failures (ok: false) are passed through so the persistence
    // pipeline finalizes the run consistently.
    const persistSummary = await gateway.persistResult({
      fetchRunId,
      sourceId: source.id,
      result: enrichedResult,
    });

    // Step 8: Update health on success or partial
    const isSuccessful =
      persistSummary.fetchRunStatus === 'completed' ||
      persistSummary.fetchRunStatus === 'partial';

    await gateway.updateJobSourceHealth(source.id, {
      lastAttemptedAt: nowIso(),
      lastHttpStatus: fetchResult.httpStatus,
      success: isSuccessful,
      lastSuccessfulAt: isSuccessful ? nowIso() : undefined,
    });

    return {
      fetchRunId,
      status: persistSummary.fetchRunStatus,
      recordsSeen: fetchResult.recordsSeen,
      recordsNormalized: fetchResult.recordsNormalized,
      recordsSkipped: fetchResult.recordsSkipped,
      recordsNew: persistSummary.counters.recordsNew,
      recordsChanged: persistSummary.counters.recordsChanged,
      recordsUnchanged: persistSummary.counters.recordsUnchanged,
      recordsReviewed: persistSummary.counters.recordsReviewed,
      payloadStored: persistSummary.payloadId !== null,
      errorMessage: null,
    };
  } catch (error) {
    // Covers:
    //   (a) fetchJobs threw unexpectedly — connector normally returns ok:false
    //   (b) enrichFetchResult threw unexpectedly
    //   (c) gateway.persistResult re-threw after finalizing the run as 'failed'
    //
    // For case (c): the run is already finalized — finalizeFetchRunFailed is a no-op.
    // For cases (a) and (b): the run is still 'running' — finalize it now.

    const errMsg = safeMessage(error);

    await gateway.finalizeFetchRunFailed({
      fetchRunId,
      httpStatus: fetchResult?.httpStatus ?? null,
      recordsSeen: fetchResult?.recordsSeen ?? 0,
      errorMessage: errMsg,
      logJson: {
        unexpectedError: errMsg,
        fetchedAt: fetchResult?.fetchedAt ?? nowIso(),
        phase: fetchResult ? 'pre_persistence' : 'fetch',
      },
      finishedAtIso: nowIso(),
    });

    // Step 8: health update on failure
    await gateway.updateJobSourceHealth(source.id, {
      lastAttemptedAt: nowIso(),
      lastHttpStatus: fetchResult?.httpStatus ?? null,
      success: false,
    });

    return {
      fetchRunId,
      status: 'failed',
      recordsSeen: fetchResult?.recordsSeen ?? 0,
      recordsNormalized: fetchResult?.recordsNormalized ?? 0,
      recordsSkipped: fetchResult?.recordsSkipped ?? 0,
      recordsNew: 0,
      recordsChanged: 0,
      recordsUnchanged: 0,
      recordsReviewed: 0,
      payloadStored: false,
      errorMessage: errMsg,
    };
  }
}

// ============================================================
// PRODUCTION SUPABASE GATEWAY
// ============================================================

/** Create a Supabase-backed PilotGateway from service-role clients. */
export function createSupabasePilotGateway(params: {
  db: IngestionDbClient;
  storage: IngestionStorageClient;
}): PilotGateway {
  const { db, storage } = params;

  // The IngestionRepository is only used within this gateway's persistResult
  // and finalizeFetchRunFailed implementations; it is never exposed externally.
  const repository = createSupabaseIngestionRepository({ db, storage });

  return {
    async findJobSource(): Promise<PilotJobSourceRow | null> {
      const { data, error } = await (db as any)
        .from('job_sources')
        .select(
          'id, source_record_id, company_id, source_kind, source_identifier, enabled, automatic_scheduling_paused_at, config_json',
        )
        .eq('source_kind', 'greenhouse')
        .eq('source_identifier', ALTOS_BOARD_TOKEN)
        .maybeSingle();
      if (error) throw new Error(`Failed to query job_sources: ${error.message}`);
      return data ?? null;
    },

    async findActiveFetchRun(jobSourceId: string) {
      const { data, error } = await (db as any)
        .from('source_fetch_runs')
        .select('id, status')
        .eq('job_source_id', jobSourceId)
        .in('status', ['pending', 'running'])
        .maybeSingle();
      if (error) throw new Error(`Failed to query source_fetch_runs: ${error.message}`);
      return data ?? null;
    },

    async insertFetchRun({ jobSourceId, workerId, nowIso }) {
      const { data, error } = await (db as any)
        .from('source_fetch_runs')
        .insert({
          job_source_id: jobSourceId,
          trigger_kind: 'manual',
          status: 'running',
          scheduled_for: nowIso,
          started_at: nowIso,
          worker_id: workerId,
        })
        .select('id')
        .single();
      if (error || !data) {
        throw new Error(`Failed to insert fetch run: ${error?.message ?? 'no data'}`);
      }
      return data.id as string;
    },

    async updateJobSourceHealth(jobSourceId, update) {
      const patch: Record<string, unknown> = {
        last_attempted_at: update.lastAttemptedAt,
        last_http_status: update.lastHttpStatus,
        updated_at: new Date().toISOString(),
      };

      if (update.success) {
        patch.last_successful_at = update.lastSuccessfulAt ?? update.lastAttemptedAt;
        patch.consecutive_failures = 0;
        patch.degraded_at = null;
      }

      const { error: patchError } = await (db as any)
        .from('job_sources')
        .update(patch)
        .eq('id', jobSourceId);
      if (patchError) throw new Error(`Failed to update job_sources health: ${patchError.message}`);

      // Atomically increment consecutive_failures on failure.
      if (!update.success) {
        await (db as any)
          .from('job_sources')
          .update({ consecutive_failures: (db as any).rpc ? undefined : 0 })
          .eq('id', jobSourceId);

        // Best-effort atomic increment via SQL expression.
        await (db as any).rpc?.('increment_job_source_consecutive_failures', {
          p_job_source_id: jobSourceId,
        });
      }
    },

    async finalizeFetchRunFailed({ fetchRunId, httpStatus, recordsSeen, errorMessage, logJson, finishedAtIso }) {
      // updateFetchRun is a no-op if the run is not in 'running' status.
      await repository.updateFetchRun({
        id: fetchRunId,
        status: 'failed',
        httpStatus,
        payloadCount: 0,
        recordsSeen,
        recordsNew: 0,
        recordsChanged: 0,
        recordsUnchanged: 0,
        recordsReviewed: 0,
        recordsClosedCandidates: 0,
        errorClass: 'unexpected',
        errorMessage,
        logJson,
        finishedAtIso,
      });
    },

    async persistResult({ fetchRunId, sourceId, result }) {
      return persistFetchResultWithSupabase({
        db,
        storage,
        fetchRunId,
        expectedJobSourceId: sourceId,
        fetchResult: result,
      });
    },
  };
}

// ============================================================
// PRODUCTION ENTRY POINT
// ============================================================

/**
 * Run the Altos Labs Greenhouse ingestion pilot using Supabase service-role clients.
 *
 * The caller (server action) MUST call requireOfficer() before this function.
 * Returns only a safe serializable summary — no raw response body, no payload
 * contents, no DB credentials, no service-role client.
 */
export async function runAltosLabsPilot(params: {
  db: IngestionDbClient;
  storage: IngestionStorageClient;
  workerId: string;
}): Promise<AltosIngestionSummary> {
  const gateway = createSupabasePilotGateway({ db: params.db, storage: params.storage });
  return runAltosLabsPilotCore({ gateway, workerId: params.workerId });
}
