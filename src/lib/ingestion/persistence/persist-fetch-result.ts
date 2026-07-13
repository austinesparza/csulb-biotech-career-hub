import 'server-only';

import type { ConnectorFetchResult, NormalizedSourcePosting, SourceFetchErrorClass } from '../types';
import { isAllowedFetchRunErrorClass, FetchRunAlreadyFinalizedError, FetchRunValidationError } from './errors';
import { bridgeOpportunityForSourcePosting, PENDING_OPPORTUNITY_MIN_SCORE } from './opportunity-bridge';
import { storeRawPayload } from './payload-storage';
import {
  createSupabaseIngestionRepository,
  deriveFetchRunFinalStatus,
  type IngestionClock,
  type IngestionDbClient,
  type IngestionRepository,
  type IngestionStorageClient,
  type PersistFetchRunCounters,
  type SourcePostingVersionRow,
} from './repository';
import { ensureOpenSourceReviewTask } from './review-tasks';
import type { SourceFetchRunStatus } from '../types';

function stableObject(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableObject);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = stableObject((value as Record<string, unknown>)[key]);
  }
  return out;
}

function pathJoin(base: string, field: string): string {
  return base ? `${base}.${field}` : field;
}

function diffDeterministic(prev: unknown, next: unknown): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};

  const walk = (p: unknown, n: unknown, path: string) => {
    const pObj = p !== null && typeof p === 'object' && !Array.isArray(p);
    const nObj = n !== null && typeof n === 'object' && !Array.isArray(n);

    if (pObj && nObj) {
      const pRec = p as Record<string, unknown>;
      const nRec = n as Record<string, unknown>;
      const keys = [...new Set([...Object.keys(pRec), ...Object.keys(nRec)])].sort();
      for (const key of keys) {
        walk(pRec[key], nRec[key], pathJoin(path, key));
      }
      return;
    }

    const pVal = stableObject(p);
    const nVal = stableObject(n);
    if (JSON.stringify(pVal) !== JSON.stringify(nVal)) {
      diff[path || '$'] = { before: pVal, after: nVal };
    }
  };

  walk(prev, next, '');
  return diff;
}

function toNormalizedSnapshot(posting: NormalizedSourcePosting): Record<string, unknown> {
  return {
    identityKey: posting.identityKey,
    externalPostingId: posting.externalPostingId,
    internalJobId: posting.internalJobId,
    requisitionId: posting.requisitionId,
    employerNameRaw: posting.employerNameRaw,
    employerNameNormalized: posting.employerNameNormalized,
    titleRaw: posting.titleRaw,
    titleNormalized: posting.titleNormalized,
    locationRaw: posting.locationRaw,
    locationNormalized: posting.locationNormalized,
    canonicalUrl: posting.canonicalUrl,
    remoteType: posting.remoteType,
    employmentType: posting.employmentType,
    classification: posting.classification,
    department: posting.department,
    departments: [...posting.departments],
    offices: [...posting.offices],
    focusArea: posting.focusArea,
    postedAt: posting.postedAt,
    closesAt: posting.closesAt,
    deadlineKind: posting.deadlineKind,
    descriptionText: posting.descriptionText,
    language: posting.language,
    sourceUpdatedAt: posting.sourceUpdatedAt,
    sourceMetadata: posting.sourceMetadata,
    uncertaintyFlags: [...posting.uncertaintyFlags],
  };
}

function safeIssues(result: ConnectorFetchResult): Array<Record<string, string | null>> {
  return result.issues.map((issue) => ({
    safeId: issue.safeId,
    code: issue.code,
    message: issue.message.slice(0, 500),
  }));
}

function toFetchRunErrorClass(result: ConnectorFetchResult): SourceFetchErrorClass | null {
  if (result.ok || !result.error) return null;
  return isAllowedFetchRunErrorClass(result.error.errorClass) ? result.error.errorClass : 'unexpected';
}

function buildSafeLog(result: ConnectorFetchResult, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: result.ok,
    fetchedAt: result.fetchedAt,
    requestUrl: result.requestUrl,
    finalUrl: result.finalUrl,
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    etag: result.etag,
    lastModified: result.lastModified,
    recordsSeen: result.recordsSeen,
    recordsNormalized: result.recordsNormalized,
    recordsSkipped: result.recordsSkipped,
    issues: safeIssues(result),
    error: result.error
      ? {
          errorClass: result.error.errorClass,
          code: result.error.code,
          message: result.error.message,
          httpStatus: result.error.httpStatus ?? null,
        }
      : null,
    ...extra,
  };
}

export interface PersistFetchResultSummary {
  fetchRunId: string;
  fetchRunStatus: SourceFetchRunStatus;
  payloadId: string | null;
  payloadInserted: boolean;
  counters: PersistFetchRunCounters;
}

export async function persistFetchResult(params: {
  repository: IngestionRepository;
  fetchRunId: string;
  expectedJobSourceId: string;
  fetchResult: ConnectorFetchResult;
  clock?: IngestionClock;
  retry?: {
    resumeFailedRun?: boolean;
  };
}): Promise<PersistFetchResultSummary> {
  const clock = params.clock ?? { now: () => new Date() };
  const run = await params.repository.getFetchRun(params.fetchRunId);
  if (!run) {
    throw new FetchRunValidationError(params.fetchRunId, 'Fetch run not found.');
  }

  if (run.job_source_id !== params.expectedJobSourceId) {
    throw new FetchRunValidationError(params.fetchRunId, `Fetch run ${params.fetchRunId} does not belong to expected source ${params.expectedJobSourceId}.`);
  }

  if (run.status === 'completed' || run.status === 'partial' || run.status === 'cancelled') {
    throw new FetchRunAlreadyFinalizedError(params.fetchRunId, run.status);
  }

  if (run.status === 'failed') {
    const canResume = params.retry?.resumeFailedRun
      && run.error_class === 'unexpected'
      && ((run.log_json && Object.prototype.hasOwnProperty.call(run.log_json, 'persistenceError'))
        || (run.log_json && Object.prototype.hasOwnProperty.call(run.log_json, 'persistence_error')));
    if (!canResume) {
      throw new FetchRunAlreadyFinalizedError(params.fetchRunId, run.status);
    }
  }

  if (run.status !== 'running') {
    throw new FetchRunValidationError(params.fetchRunId, `Fetch run must be running before persistence (got ${run.status}).`);
  }

  const jobSource = await params.repository.getJobSource(params.expectedJobSourceId);
  if (!jobSource) {
    throw new FetchRunValidationError(params.fetchRunId, `Job source ${params.expectedJobSourceId} not found.`);
  }

  let payloadId: string | null = null;
  let payloadInserted = false;
  const counters: PersistFetchRunCounters = {
    recordsNew: 0,
    recordsChanged: 0,
    recordsUnchanged: 0,
    recordsReviewed: 0,
    recordsClosedCandidates: 0,
  };
  const result = params.fetchResult;
  let staleObservationCount = 0;

  try {
    const payload = await storeRawPayload({
      repository: params.repository,
      fetchRunId: params.fetchRunId,
      jobSourceId: params.expectedJobSourceId,
      fetchResult: params.fetchResult,
    });
    payloadId = payload?.payload.id ?? null;
    payloadInserted = payload?.inserted ?? false;

    if (result.ok && result.candidates.length > 0 && payload == null) {
      throw new FetchRunValidationError(params.fetchRunId, 'Successful fetch results with candidates require a stored raw payload.');
    }

    if (result.ok && payload) {
      for (const candidate of result.candidates) {
      const existing = await params.repository.findPostingByIdentity(params.expectedJobSourceId, candidate.identityKey);
      const reopenedFromCurrent = existing != null && ['closed', 'missing', 'closure_candidate'].includes(existing.current_status);
      const currentStatus = reopenedFromCurrent ? 'reopened' as const : 'open' as const;

      const upsertInput = {
        jobSourceId: params.expectedJobSourceId,
        identityKey: candidate.identityKey,
        canonicalUrl: candidate.canonicalUrl,
        externalPostingId: candidate.externalPostingId,
        employerNameRaw: candidate.employerNameRaw,
        employerNameNormalized: candidate.employerNameNormalized,
        titleRaw: candidate.titleRaw,
        titleNormalized: candidate.titleNormalized,
        locationRaw: candidate.locationRaw,
        locationNormalized: candidate.locationNormalized,
        remoteType: candidate.remoteType,
        employmentType: candidate.employmentType,
        classification: candidate.classification,
        department: candidate.department,
        focusArea: candidate.focusArea,
        postedAt: candidate.postedAt,
        closesAt: candidate.closesAt,
        deadlineKind: candidate.deadlineKind,
        currentStatus,
        relevanceScore: candidate.relevanceScore,
        relevanceScoreVersion: candidate.relevanceScoreVersion,
        scoreBreakdownJson: stableObject(candidate.scoreBreakdown) as Record<string, unknown>,
        uncertaintyFlags: candidate.uncertaintyFlags,
        lastPayloadId: payload.payload.id,
        lastMaterialHash: candidate.materialHash,
        observedAtIso: candidate.fetchedAt,
      };

      const upsert = await params.repository.upsertPostingObservation({
        fetchRunId: params.fetchRunId,
        ...upsertInput,
      });
      const posting = upsert.posting;
      const isFirstObservation = upsert.created;
      const materialChanged = upsert.materialChanged;
      const reopened = upsert.wasPreviouslyClosed;

      if (upsert.staleObservation) {
        staleObservationCount += 1;
        counters.recordsUnchanged += 1;
        continue;
      }

      const priorVersion: SourcePostingVersionRow | null = await params.repository.getLatestVersion(posting.id);

      if (upsert.created) counters.recordsNew += 1;
      else if (materialChanged) counters.recordsChanged += 1;
      else counters.recordsUnchanged += 1;

      if (materialChanged) {
        const normalizedSnapshot = toNormalizedSnapshot(candidate);
        const fieldDiff = priorVersion
          ? diffDeterministic(priorVersion.normalized_json, normalizedSnapshot)
          : {};

        await params.repository.insertPostingVersion({
          sourcePostingId: posting.id,
          sourceFetchRunId: params.fetchRunId,
          sourcePayloadId: payload.payload.id,
          connectorVersion: candidate.connectorVersion,
          isMaterialChange: !isFirstObservation,
          materialHash: candidate.materialHash,
          normalizedJson: normalizedSnapshot,
          scoreBreakdownJson: stableObject(candidate.scoreBreakdown) as Record<string, unknown>,
          fieldDiffJson: fieldDiff,
        });
      }

      if (upsert.created && candidate.relevanceScore >= PENDING_OPPORTUNITY_MIN_SCORE) {
        counters.recordsReviewed += 1;
        await ensureOpenSourceReviewTask({
          repository: params.repository,
          taskType: 'source_new',
          entityTable: 'source_postings',
          entityId: posting.id,
          materialHash: candidate.materialHash,
          noteTag: 'source_new',
          noteBody: `New relevant source posting observed (${candidate.identityKey}).`,
        });
      }

      if (existing && materialChanged) {
        counters.recordsReviewed += 1;
        await ensureOpenSourceReviewTask({
          repository: params.repository,
          taskType: 'source_changed',
          entityTable: 'source_postings',
          entityId: posting.id,
          materialHash: candidate.materialHash,
          noteTag: 'source_changed',
          noteBody: `Material change detected for source posting ${candidate.identityKey}.`,
        });
      }

      if (reopened) {
        counters.recordsReviewed += 1;
        await ensureOpenSourceReviewTask({
          repository: params.repository,
          taskType: 'source_reopened',
          entityTable: 'source_postings',
          entityId: posting.id,
          materialHash: candidate.materialHash,
          noteTag: 'source_reopened',
          noteBody: `Previously closed posting was observed open again (${candidate.identityKey}).`,
        });
      }

      await bridgeOpportunityForSourcePosting({
        repository: params.repository,
        jobSource,
        sourcePosting: posting,
        posting: candidate,
        materialChanged,
      });
    }
    }

    const finalStatus = deriveFetchRunFinalStatus(result);
    const safeLog = buildSafeLog(result, {
      payloadStored: payloadId != null,
      payloadId,
      counters,
      staleObservationCount,
    });

    const finalized = await params.repository.updateFetchRun({
      id: params.fetchRunId,
      status: finalStatus,
      httpStatus: result.httpStatus,
      payloadCount: payloadId ? 1 : 0,
      recordsSeen: result.recordsSeen,
      recordsNew: counters.recordsNew,
      recordsChanged: counters.recordsChanged,
      recordsUnchanged: counters.recordsUnchanged,
      recordsReviewed: counters.recordsReviewed,
      recordsClosedCandidates: counters.recordsClosedCandidates,
      errorClass: toFetchRunErrorClass(result),
      errorMessage: result.error?.message ?? null,
      logJson: safeLog,
      finishedAtIso: clock.now().toISOString(),
    });
    if (!finalized.updated) {
      throw new FetchRunValidationError(params.fetchRunId, 'Fetch run finalization race detected; run was already finalized or cancelled.');
    }

    return {
      fetchRunId: params.fetchRunId,
      fetchRunStatus: finalStatus,
      payloadId,
      payloadInserted,
      counters,
    };
  } catch (error) {
    const failed = await params.repository.updateFetchRun({
      id: params.fetchRunId,
      status: 'failed',
      httpStatus: result.httpStatus,
      payloadCount: payloadId ? 1 : 0,
      recordsSeen: result.recordsSeen,
      recordsNew: counters.recordsNew,
      recordsChanged: counters.recordsChanged,
      recordsUnchanged: counters.recordsUnchanged,
      recordsReviewed: counters.recordsReviewed,
      recordsClosedCandidates: counters.recordsClosedCandidates,
      errorClass: 'unexpected',
      errorMessage: error instanceof Error ? error.message : String(error),
      logJson: buildSafeLog(result, {
        payloadStored: payloadId != null,
        payloadId,
        persistenceError: error instanceof Error ? error.message : String(error),
        staleObservationCount,
      }),
      finishedAtIso: clock.now().toISOString(),
    });
    if (!failed.updated) {
      throw new FetchRunValidationError(params.fetchRunId, 'Fetch run failure transition race detected; run was already finalized or cancelled.');
    }
    throw error;
  }
}

export async function persistFetchResultWithSupabase(params: {
  db: IngestionDbClient;
  storage: IngestionStorageClient;
  fetchRunId: string;
  expectedJobSourceId: string;
  fetchResult: ConnectorFetchResult;
  clock?: IngestionClock;
  retry?: {
    resumeFailedRun?: boolean;
  };
}): Promise<PersistFetchResultSummary> {
  const repository = createSupabaseIngestionRepository({ db: params.db, storage: params.storage, clock: params.clock });
  return persistFetchResult({
    repository,
    fetchRunId: params.fetchRunId,
    expectedJobSourceId: params.expectedJobSourceId,
    fetchResult: params.fetchResult,
    clock: params.clock,
    retry: params.retry,
  });
}

export { diffDeterministic };
