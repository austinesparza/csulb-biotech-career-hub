import 'server-only';

import { matchCompany } from '../../dedupe';
import { normalizeCompanyName } from '../../normalize';

import type {
  ConnectorFetchResult,
  PersistedLinkMatchType,
  PostingStatus,
  SourceFetchErrorClass,
  SourceFetchRunStatus,
} from '../types';

export interface IngestionClock {
  now(): Date;
}

export interface IngestionStorageClient {
  from(bucket: string): {
    upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
  };
}

export interface IngestionDbClient {
  from(table: string): any;
  rpc?(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: { message: string; code?: string } | null }>;
}

export interface SourceFetchRunRow {
  id: string;
  job_source_id: string;
  status: SourceFetchRunStatus;
  started_at: string | null;
  finished_at: string | null;
  error_class?: SourceFetchErrorClass | null;
  log_json?: Record<string, unknown> | null;
}

export interface JobSourceRow {
  id: string;
  source_record_id: string;
  company_id: string | null;
  source_name: string;
}

export interface SourcePayloadRow {
  id: string;
  source_fetch_run_id: string;
  request_url: string;
  sha256: string;
  storage_path: string;
}

export interface SourcePostingRow {
  id: string;
  job_source_id: string;
  identity_key: string;
  canonical_url: string;
  current_status: PostingStatus;
  first_seen_at: string;
  last_seen_at: string;
  last_material_hash: string;
  relevance_score: number | null;
  relevance_score_version: number | null;
}

export interface SourcePostingVersionRow {
  id: string;
  source_posting_id: string;
  material_hash: string;
  normalized_json: Record<string, unknown>;
}

export interface ReviewTaskRow {
  id: string;
  task_type: string;
  entity_table: string;
  entity_id: string;
  status: string;
  notes: string | null;
}

export interface OpportunityRow {
  id: string;
  company_id: string | null;
  title: string;
  posting_url: string | null;
  dedupe_key: string | null;
  family_key: string | null;
  review_status: string;
  public_safe: boolean;
  last_seen_at: string;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  paid_status: string;
  application_type: string | null;
  source_status_raw: string | null;
  status: string;
}

export interface OpportunitySourceLinkRow {
  id: string;
  opportunity_id: string;
  source_posting_id: string;
  match_type: PersistedLinkMatchType;
  is_primary: boolean;
}

export interface CompanyRow {
  id: string;
  name: string;
  name_normalized: string;
}

export interface CompanyResolutionResult {
  companyId: string | null;
  matchedFuzzy: boolean;
}

export interface UpsertPostingInput {
  jobSourceId: string;
  identityKey: string;
  canonicalUrl: string;
  externalPostingId: string | null;
  employerNameRaw: string | null;
  employerNameNormalized: string | null;
  titleRaw: string | null;
  titleNormalized: string | null;
  locationRaw: string | null;
  locationNormalized: string | null;
  remoteType: string | null;
  employmentType: string | null;
  classification: string | null;
  department: string | null;
  focusArea: string | null;
  postedAt: string | null;
  closesAt: string | null;
  deadlineKind: string | null;
  currentStatus: PostingStatus;
  relevanceScore: number;
  relevanceScoreVersion: number;
  scoreBreakdownJson: Record<string, unknown>;
  uncertaintyFlags: string[];
  lastPayloadId: string | null;
  lastMaterialHash: string;
  observedAtIso: string;
}

export interface UpsertPostingResult {
  posting: SourcePostingRow;
  created: boolean;
  wasPreviouslyClosed: boolean;
  materialChanged: boolean;
  staleObservation: boolean;
}

export interface UpdateFetchRunInput {
  id: string;
  status: SourceFetchRunStatus;
  httpStatus: number | null;
  payloadCount: number;
  recordsSeen: number;
  recordsNew: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsReviewed: number;
  recordsClosedCandidates: number;
  errorClass: SourceFetchErrorClass | null;
  errorMessage: string | null;
  logJson: Record<string, unknown>;
  finishedAtIso: string;
}

export interface UpdateFetchRunResult {
  updated: boolean;
}

function isDuplicateKeyError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key|already exists/i.test(error.message ?? '');
}

function isoDateOrNull(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function hasSufficientEmployerIdentity(nameRaw: string | null, nameNormalized: string | null): boolean {
  const raw = (nameRaw ?? '').trim();
  const normalized = (nameNormalized ?? '').trim();
  return raw.length >= 3 || normalized.length >= 3;
}

export interface IngestionRepository {
  getFetchRun(fetchRunId: string): Promise<SourceFetchRunRow | null>;
  getJobSource(jobSourceId: string): Promise<JobSourceRow | null>;
  beginFailedRunResume(fetchRunId: string, expectedJobSourceId: string): Promise<boolean>;
  updateFetchRun(input: UpdateFetchRunInput): Promise<UpdateFetchRunResult>;
  uploadPayloadObject(storagePath: string, payload: Uint8Array): Promise<void>;
  getPayloadByUniqueKey(fetchRunId: string, payloadHash: string, requestUrl: string): Promise<SourcePayloadRow | null>;
  insertPayloadMetadata(input: {
    sourceFetchRunId: string;
    requestUrl: string;
    finalUrl: string | null;
    contentType: string | null;
    etag: string | null;
    lastModified: string | null;
    statusCode: number | null;
    sha256: string;
    sizeBytes: number;
    storagePath: string;
  }): Promise<SourcePayloadRow>;
  findPostingByIdentity(jobSourceId: string, identityKey: string): Promise<SourcePostingRow | null>;
  insertPosting(input: UpsertPostingInput): Promise<SourcePostingRow>;
  updatePosting(id: string, input: UpsertPostingInput): Promise<SourcePostingRow>;
  upsertPostingObservation(input: UpsertPostingInput & { fetchRunId: string }): Promise<UpsertPostingResult>;
  getLatestVersion(sourcePostingId: string): Promise<SourcePostingVersionRow | null>;
  getVersionByMaterialHash(sourcePostingId: string, materialHash: string): Promise<SourcePostingVersionRow | null>;
  insertPostingVersion(input: {
    sourcePostingId: string;
    sourceFetchRunId: string;
    sourcePayloadId: string;
    connectorVersion: string;
    isMaterialChange: boolean;
    materialHash: string;
    normalizedJson: Record<string, unknown>;
    scoreBreakdownJson: Record<string, unknown>;
    fieldDiffJson: Record<string, unknown>;
  }): Promise<SourcePostingVersionRow>;
  findOpenReviewTask(taskType: string, entityTable: string, entityId: string, notes: string): Promise<ReviewTaskRow | null>;
  insertReviewTask(taskType: string, entityTable: string, entityId: string, notes: string): Promise<ReviewTaskRow>;
  listMatchableOpportunities(): Promise<OpportunityRow[]>;
  findOpportunityById(opportunityId: string): Promise<OpportunityRow | null>;
  updateOpportunityObservation(opportunityId: string, observedAtIso: string): Promise<void>;
  updateOpportunityDraftFromPosting(opportunityId: string, input: {
    title: string;
    postingUrl: string;
    location: string | null;
    focusArea: string | null;
    deadline: string | null;
    deadlineText: string | null;
    applicationType: string | null;
    sourceStatusRaw: string | null;
    relevanceScore: number;
    relevanceReasons: string[];
    observedAtIso: string;
  }): Promise<void>;
  insertPendingOpportunity(input: {
    companyId: string | null;
    sourceRecordId: string;
    title: string;
    postingUrl: string;
    location: string | null;
    focusArea: string | null;
    deadline: string | null;
    deadlineText: string | null;
    paidStatus: 'unknown';
    applicationType: string | null;
    sourceStatusRaw: string | null;
    relevanceScore: number;
    dedupeKey: string;
    familyKey: string;
    observedAtIso: string;
  }): Promise<OpportunityRow>;
  getLink(opportunityId: string, sourcePostingId: string): Promise<OpportunitySourceLinkRow | null>;
  getPrimaryLink(opportunityId: string): Promise<OpportunitySourceLinkRow | null>;
  insertLink(input: {
    opportunityId: string;
    sourcePostingId: string;
    matchType: PersistedLinkMatchType;
    isPrimary: boolean;
  }): Promise<OpportunitySourceLinkRow>;
  resolveCompanyId(jobSource: JobSourceRow, employerNameRaw: string | null, employerNameNormalized: string | null): Promise<CompanyResolutionResult>;
}

export function createSupabaseIngestionRepository(params: {
  db: IngestionDbClient;
  storage: IngestionStorageClient;
  clock?: IngestionClock;
}): IngestionRepository {
  const db = params.db;
  const storage = params.storage;

  return {
    async getFetchRun(fetchRunId) {
      const { data, error } = await db.from('source_fetch_runs')
        .select('id, job_source_id, status, started_at, finished_at, error_class, log_json')
        .eq('id', fetchRunId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async getJobSource(jobSourceId) {
      const { data, error } = await db.from('job_sources')
        .select('id, source_record_id, company_id, source_name')
        .eq('id', jobSourceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async beginFailedRunResume(fetchRunId, expectedJobSourceId) {
      const { data, error } = await db.from('source_fetch_runs').update({
        status: 'running',
        started_at: new Date().toISOString(),
        finished_at: null,
      }).eq('id', fetchRunId)
        .eq('job_source_id', expectedJobSourceId)
        .eq('status', 'failed')
        .eq('error_class', 'unexpected')
        .select('id');
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    },

    async updateFetchRun(input) {
      const { data, error } = await db.from('source_fetch_runs').update({
        status: input.status,
        http_status: input.httpStatus,
        payload_count: input.payloadCount,
        records_seen: input.recordsSeen,
        records_new: input.recordsNew,
        records_changed: input.recordsChanged,
        records_unchanged: input.recordsUnchanged,
        records_reviewed: input.recordsReviewed,
        records_closed_candidates: input.recordsClosedCandidates,
        error_class: input.errorClass,
        error_message: input.errorMessage,
        log_json: input.logJson,
        finished_at: input.finishedAtIso,
      }).eq('id', input.id)
        .eq('status', 'running')
        .select('id');

      if (error) throw new Error(error.message);
      return { updated: (data ?? []).length === 1 };
    },

    async uploadPayloadObject(storagePath, payload) {
      const { error } = await storage
        .from('source-payloads')
        .upload(storagePath, payload, { contentType: 'text/plain; charset=utf-8', upsert: false });

      if (error && !/already exists/i.test(error.message)) {
        throw new Error(error.message);
      }
    },

    async getPayloadByUniqueKey(fetchRunId, payloadHash, requestUrl) {
      const { data, error } = await db.from('source_payloads')
        .select('id, source_fetch_run_id, request_url, sha256, storage_path')
        .eq('source_fetch_run_id', fetchRunId)
        .eq('sha256', payloadHash)
        .eq('request_url', requestUrl)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async insertPayloadMetadata(input) {
      const { data, error } = await db.from('source_payloads').insert({
        source_fetch_run_id: input.sourceFetchRunId,
        request_url: input.requestUrl,
        final_url: input.finalUrl,
        content_type: input.contentType,
        etag: input.etag,
        last_modified: input.lastModified,
        status_code: input.statusCode,
        sha256: input.sha256,
        size_bytes: input.sizeBytes,
        storage_path: input.storagePath,
      }).select('id, source_fetch_run_id, request_url, sha256, storage_path').single();

      if (error) {
        if (isDuplicateKeyError(error)) {
          const existing = await this.getPayloadByUniqueKey(input.sourceFetchRunId, input.sha256, input.requestUrl);
          if (existing) return existing;
        }
        throw new Error(error.message);
      }

      return data;
    },

    async findPostingByIdentity(jobSourceId, identityKey) {
      const { data, error } = await db.from('source_postings')
        .select('id, job_source_id, identity_key, canonical_url, current_status, first_seen_at, last_seen_at, last_material_hash, relevance_score, relevance_score_version')
        .eq('job_source_id', jobSourceId)
        .eq('identity_key', identityKey)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async upsertPostingObservation(input) {
      if (db.rpc) {
        const { data, error } = await db.rpc('upsert_source_posting_observation', {
          p_fetch_run_id: input.fetchRunId,
          p_job_source_id: input.jobSourceId,
          p_identity_key: input.identityKey,
          p_canonical_url: input.canonicalUrl,
          p_external_posting_id: input.externalPostingId,
          p_employer_name_raw: input.employerNameRaw,
          p_employer_name_normalized: input.employerNameNormalized,
          p_title_raw: input.titleRaw,
          p_title_normalized: input.titleNormalized,
          p_location_raw: input.locationRaw,
          p_location_normalized: input.locationNormalized,
          p_remote_type: input.remoteType,
          p_employment_type: input.employmentType,
          p_classification: input.classification,
          p_department: input.department,
          p_focus_area: input.focusArea,
          p_posted_at: isoDateOrNull(input.postedAt),
          p_closes_at: isoDateOrNull(input.closesAt),
          p_deadline_kind: input.deadlineKind,
          p_current_status: input.currentStatus,
          p_relevance_score: input.relevanceScore,
          p_relevance_score_version: input.relevanceScoreVersion,
          p_score_breakdown_json: input.scoreBreakdownJson,
          p_uncertainty_flags: input.uncertaintyFlags,
          p_last_payload_id: input.lastPayloadId,
          p_last_material_hash: input.lastMaterialHash,
          p_observed_at: input.observedAtIso,
        });
        if (error) throw new Error(error.message);
        const row = Array.isArray(data) ? data[0] : data;
        return {
          posting: {
            id: row.posting_id,
            job_source_id: row.job_source_id,
            identity_key: row.identity_key,
            canonical_url: row.canonical_url,
            current_status: row.current_status,
            first_seen_at: row.first_seen_at,
            last_seen_at: row.last_seen_at,
            last_material_hash: row.last_material_hash,
            relevance_score: row.relevance_score,
            relevance_score_version: row.relevance_score_version,
          },
          created: row.created,
          wasPreviouslyClosed: row.reopened,
          materialChanged: row.material_changed,
          staleObservation: row.stale_observation,
        };
      }

      const existing = await this.findPostingByIdentity(input.jobSourceId, input.identityKey);
      if (!existing) {
        const posting = await this.insertPosting(input);
        return { posting, created: true, wasPreviouslyClosed: false, materialChanged: true, staleObservation: false };
      }
      if (new Date(input.observedAtIso).getTime() < new Date(existing.last_seen_at).getTime()) {
        return { posting: existing, created: false, wasPreviouslyClosed: false, materialChanged: false, staleObservation: true };
      }
      const wasPreviouslyClosed = ['closed', 'missing', 'closure_candidate'].includes(existing.current_status);
      const materialChanged = existing.last_material_hash !== input.lastMaterialHash;
      const posting = await this.updatePosting(existing.id, input);
      return { posting, created: false, wasPreviouslyClosed, materialChanged, staleObservation: false };
    },

    async insertPosting(input) {
      const { data, error } = await db.from('source_postings').insert({
        job_source_id: input.jobSourceId,
        identity_key: input.identityKey,
        canonical_url: input.canonicalUrl,
        external_posting_id: input.externalPostingId,
        employer_name_raw: input.employerNameRaw,
        employer_name_normalized: input.employerNameNormalized,
        title_raw: input.titleRaw,
        title_normalized: input.titleNormalized,
        location_raw: input.locationRaw,
        location_normalized: input.locationNormalized,
        remote_type: input.remoteType,
        employment_type: input.employmentType,
        classification: input.classification,
        department: input.department,
        focus_area: input.focusArea,
        posted_at: isoDateOrNull(input.postedAt),
        closes_at: isoDateOrNull(input.closesAt),
        deadline_kind: input.deadlineKind,
        current_status: input.currentStatus,
        relevance_score: input.relevanceScore,
        relevance_score_version: input.relevanceScoreVersion,
        score_breakdown_json: input.scoreBreakdownJson,
        uncertainty_flags: input.uncertaintyFlags,
        first_seen_at: input.observedAtIso,
        last_seen_at: input.observedAtIso,
        last_payload_id: input.lastPayloadId,
        last_material_hash: input.lastMaterialHash,
        consecutive_misses: 0,
      }).select('id, job_source_id, identity_key, canonical_url, current_status, first_seen_at, last_seen_at, last_material_hash, relevance_score, relevance_score_version').single();

      if (error) {
        if (isDuplicateKeyError(error)) {
          const existing = await this.findPostingByIdentity(input.jobSourceId, input.identityKey);
          if (existing) return existing;
        }
        throw new Error(error.message);
      }

      return data;
    },

    async updatePosting(id, input) {
      const { data, error } = await db.from('source_postings').update({
        canonical_url: input.canonicalUrl,
        external_posting_id: input.externalPostingId,
        employer_name_raw: input.employerNameRaw,
        employer_name_normalized: input.employerNameNormalized,
        title_raw: input.titleRaw,
        title_normalized: input.titleNormalized,
        location_raw: input.locationRaw,
        location_normalized: input.locationNormalized,
        remote_type: input.remoteType,
        employment_type: input.employmentType,
        classification: input.classification,
        department: input.department,
        focus_area: input.focusArea,
        posted_at: isoDateOrNull(input.postedAt),
        closes_at: isoDateOrNull(input.closesAt),
        deadline_kind: input.deadlineKind,
        current_status: input.currentStatus,
        relevance_score: input.relevanceScore,
        relevance_score_version: input.relevanceScoreVersion,
        score_breakdown_json: input.scoreBreakdownJson,
        uncertainty_flags: input.uncertaintyFlags,
        last_seen_at: input.observedAtIso,
        last_payload_id: input.lastPayloadId,
        last_material_hash: input.lastMaterialHash,
        consecutive_misses: 0,
      }).eq('id', id)
        .select('id, job_source_id, identity_key, canonical_url, current_status, first_seen_at, last_seen_at, last_material_hash, relevance_score, relevance_score_version')
        .single();

      if (error) throw new Error(error.message);
      return data;
    },

    async getLatestVersion(sourcePostingId) {
      const { data, error } = await db.from('source_posting_versions')
        .select('id, source_posting_id, material_hash, normalized_json')
        .eq('source_posting_id', sourcePostingId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async getVersionByMaterialHash(sourcePostingId, materialHash) {
      const { data, error } = await db.from('source_posting_versions')
        .select('id, source_posting_id, material_hash, normalized_json')
        .eq('source_posting_id', sourcePostingId)
        .eq('material_hash', materialHash)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async insertPostingVersion(input) {
      const { data, error } = await db.from('source_posting_versions').insert({
        source_posting_id: input.sourcePostingId,
        source_fetch_run_id: input.sourceFetchRunId,
        source_payload_id: input.sourcePayloadId,
        connector_version: input.connectorVersion,
        is_material_change: input.isMaterialChange,
        material_hash: input.materialHash,
        normalized_json: input.normalizedJson,
        score_breakdown_json: input.scoreBreakdownJson,
        field_diff_json: input.fieldDiffJson,
      }).select('id, source_posting_id, material_hash, normalized_json').single();

      if (error) {
        if (isDuplicateKeyError(error)) {
          const existing = await this.getVersionByMaterialHash(input.sourcePostingId, input.materialHash);
          if (existing) return existing;
        }
        throw new Error(error.message);
      }
      return data;
    },

    async findOpenReviewTask(taskType, entityTable, entityId, notes) {
      const { data, error } = await db.from('review_tasks')
        .select('id, task_type, entity_table, entity_id, status, notes')
        .eq('status', 'open')
        .eq('task_type', taskType)
        .eq('entity_table', entityTable)
        .eq('entity_id', entityId)
        .eq('notes', notes)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async insertReviewTask(taskType, entityTable, entityId, notes) {
      const existing = await this.findOpenReviewTask(taskType, entityTable, entityId, notes);
      if (existing) return existing;

      const { data, error } = await db.from('review_tasks').insert({
        task_type: taskType,
        entity_table: entityTable,
        entity_id: entityId,
        status: 'open',
        notes,
      }).select('id, task_type, entity_table, entity_id, status, notes').single();

      if (error) {
        if (isDuplicateKeyError(error)) {
          const race = await this.findOpenReviewTask(taskType, entityTable, entityId, notes);
          if (race) return race;
        }
        throw new Error(error.message);
      }
      return data;
    },

    async listMatchableOpportunities() {
      const pageSize = 500;
      const rows: OpportunityRow[] = [];
      let offset = 0;
      while (true) {
        const { data, error } = await db.from('opportunities').select(
          'id, company_id, title, posting_url, dedupe_key, family_key, review_status, public_safe, last_seen_at, location, eligibility, focus_area, deadline, deadline_text, paid_status, application_type, source_status_raw, status',
        )
          .not('status', 'in', '(duplicate,not_relevant,hidden,archive_only)')
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) throw new Error(error.message);
        const page = data ?? [];
        rows.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }
      return rows;
    },

    async findOpportunityById(opportunityId) {
      const { data, error } = await db.from('opportunities').select(
        'id, company_id, title, posting_url, dedupe_key, family_key, review_status, public_safe, last_seen_at, location, eligibility, focus_area, deadline, deadline_text, paid_status, application_type, source_status_raw, status',
      ).eq('id', opportunityId).maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async updateOpportunityObservation(opportunityId, observedAtIso) {
      const { error } = await db.from('opportunities').update({ last_seen_at: observedAtIso }).eq('id', opportunityId);
      if (error) throw new Error(error.message);
    },

    async updateOpportunityDraftFromPosting(opportunityId, input) {
      const { error } = await db.from('opportunities').update({
        title: input.title,
        posting_url: input.postingUrl,
        location: input.location,
        focus_area: input.focusArea,
        deadline: input.deadline,
        deadline_text: input.deadlineText,
        application_type: input.applicationType,
        source_status_raw: input.sourceStatusRaw,
        relevance_score: input.relevanceScore,
        relevance_reasons: input.relevanceReasons,
        last_seen_at: input.observedAtIso,
        status: 'needs_review',
        review_status: 'pending',
        public_safe: false,
      }).eq('id', opportunityId);

      if (error) throw new Error(error.message);
    },

    async insertPendingOpportunity(input) {
      const { data, error } = await db.from('opportunities').insert({
        company_id: input.companyId,
        source_record_id: input.sourceRecordId,
        title: input.title,
        posting_url: input.postingUrl,
        location: input.location,
        focus_area: input.focusArea,
        deadline: input.deadline,
        deadline_text: input.deadlineText,
        paid_status: input.paidStatus,
        application_type: input.applicationType,
        source_status_raw: input.sourceStatusRaw,
        status: 'needs_review',
        review_status: 'pending',
        public_safe: false,
        relevance_score: input.relevanceScore,
        relevance_reasons: [`score:${input.relevanceScore}`],
        dedupe_key: input.dedupeKey,
        family_key: input.familyKey,
        first_seen_at: input.observedAtIso,
        last_seen_at: input.observedAtIso,
      }).select(
        'id, company_id, title, posting_url, dedupe_key, family_key, review_status, public_safe, last_seen_at, location, eligibility, focus_area, deadline, deadline_text, paid_status, application_type, source_status_raw, status',
      ).single();

      if (error) {
        if (isDuplicateKeyError(error)) {
          const opportunities = await this.listMatchableOpportunities();
          const found = opportunities.find((o) => o.dedupe_key === input.dedupeKey);
          if (found) return found;
        }
        throw new Error(error.message);
      }
      return data;
    },

    async getLink(opportunityId, sourcePostingId) {
      const { data, error } = await db.from('opportunity_source_links')
        .select('id, opportunity_id, source_posting_id, match_type, is_primary')
        .eq('opportunity_id', opportunityId)
        .eq('source_posting_id', sourcePostingId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async getPrimaryLink(opportunityId) {
      const { data, error } = await db.from('opportunity_source_links')
        .select('id, opportunity_id, source_posting_id, match_type, is_primary')
        .eq('opportunity_id', opportunityId)
        .eq('is_primary', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },

    async insertLink(input) {
      const existing = await this.getLink(input.opportunityId, input.sourcePostingId);
      if (existing) return existing;

      const { data, error } = await db.from('opportunity_source_links').insert({
        opportunity_id: input.opportunityId,
        source_posting_id: input.sourcePostingId,
        match_type: input.matchType,
        is_primary: input.isPrimary,
      }).select('id, opportunity_id, source_posting_id, match_type, is_primary').single();

      if (error) {
        if (isDuplicateKeyError(error)) {
          if (input.isPrimary) {
            const fallback = await db.from('opportunity_source_links').insert({
              opportunity_id: input.opportunityId,
              source_posting_id: input.sourcePostingId,
              match_type: input.matchType,
              is_primary: false,
            }).select('id, opportunity_id, source_posting_id, match_type, is_primary').single();
            if (!fallback.error) return fallback.data;
          }
          const race = await this.getLink(input.opportunityId, input.sourcePostingId);
          if (race) return race;
        }
        throw new Error(error.message);
      }

      return data;
    },

    async resolveCompanyId(jobSource, employerNameRaw, employerNameNormalized) {
      if (jobSource.company_id) {
        const { data, error } = await db.from('companies').select('id').eq('id', jobSource.company_id).maybeSingle();
        if (error) throw new Error(error.message);
        if (data?.id) return { companyId: data.id, matchedFuzzy: false };
      }

      const normalizedName = (employerNameNormalized ?? '').trim() || (employerNameRaw ? normalizeCompanyName(employerNameRaw) : '');
      if (!normalizedName) return { companyId: null, matchedFuzzy: false };

      const { data: companies, error } = await db.from('companies').select('id, name, name_normalized');
      if (error) throw new Error(error.message);
      const match = matchCompany(normalizedName, companies ?? []);
      if (match.kind === 'exact') return { companyId: match.companyId, matchedFuzzy: false };
      if (match.kind === 'fuzzy') return { companyId: match.companyId, matchedFuzzy: true };
      if (!hasSufficientEmployerIdentity(employerNameRaw, employerNameNormalized)) {
        return { companyId: null, matchedFuzzy: false };
      }

      const rawName = (employerNameRaw ?? employerNameNormalized ?? '').trim();
      const { data: inserted, error: insertError } = await db.from('companies').insert({
        name: rawName,
        name_normalized: normalizedName,
        public_safe: false,
      }).select('id, name, name_normalized').single();
      if (insertError) {
        if (isDuplicateKeyError(insertError)) {
          const { data: existing, error: existingError } = await db.from('companies')
            .select('id, name, name_normalized')
            .eq('name_normalized', normalizedName)
            .maybeSingle();
          if (existingError) throw new Error(existingError.message);
          if (existing?.id) return { companyId: existing.id, matchedFuzzy: false };
        }
        throw new Error(insertError.message);
      }
      return { companyId: inserted.id, matchedFuzzy: false };
    },
  };
}

export interface PersistFetchRunCounters {
  recordsNew: number;
  recordsChanged: number;
  recordsUnchanged: number;
  recordsReviewed: number;
  recordsClosedCandidates: number;
}

export function deriveFetchRunFinalStatus(result: ConnectorFetchResult): SourceFetchRunStatus {
  if (!result.ok) return 'failed';
  return result.issues.length > 0 || result.recordsSkipped > 0 ? 'partial' : 'completed';
}
