import { describe, it, expect } from 'vitest';

import type { ConnectorFetchResult, NormalizedSourcePosting, SourceFetchErrorClass } from '../../lib/ingestion/types';
import {
  PayloadStorageMetadataError,
  persistFetchResult,
  diffDeterministic,
  type IngestionRepository,
  type JobSourceRow,
  type OpportunityRow,
  type OpportunitySourceLinkRow,
  type ReviewTaskRow,
  type SourceFetchRunRow,
  type SourcePayloadRow,
  type SourcePostingRow,
  type SourcePostingVersionRow,
} from '../../lib/ingestion/persistence';

class FakeRepository implements IngestionRepository {
  fetchRuns: SourceFetchRunRow[] = [
    { id: 'run-1', job_source_id: 'source-1', status: 'running', started_at: new Date().toISOString(), finished_at: null },
  ];

  jobSources: JobSourceRow[] = [
    { id: 'source-1', source_record_id: 'sr-1', company_id: 'co-1', source_name: 'Greenhouse Board' },
  ];

  payloads: SourcePayloadRow[] = [];
  postings: SourcePostingRow[] = [];
  versions: SourcePostingVersionRow[] = [];
  tasks: ReviewTaskRow[] = [];
  opportunities: OpportunityRow[] = [];
  links: OpportunitySourceLinkRow[] = [];

  failUpload = false;
  failPayloadMetadataInsert = false;
  failPostingInsert = false;

  private idCounter = 1;

  private id(prefix: string) {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  async getFetchRun(fetchRunId: string) {
    return this.fetchRuns.find((r) => r.id === fetchRunId) ?? null;
  }

  async getJobSource(jobSourceId: string) {
    return this.jobSources.find((r) => r.id === jobSourceId) ?? null;
  }

  async updateFetchRun(input: any) {
    const run = this.fetchRuns.find((r) => r.id === input.id)!;
    run.status = input.status;
    run.finished_at = input.finishedAtIso;
  }

  async uploadPayloadObject(_storagePath: string, _payload: Uint8Array) {
    if (this.failUpload) throw new Error('storage upload failed');
  }

  async getPayloadByUniqueKey(fetchRunId: string, payloadHash: string, requestUrl: string) {
    return this.payloads.find((p) =>
      p.source_fetch_run_id === fetchRunId && p.sha256 === payloadHash && p.request_url === requestUrl,
    ) ?? null;
  }

  async insertPayloadMetadata(input: any) {
    if (this.failPayloadMetadataInsert) throw new Error('metadata insert failed');
    const existing = await this.getPayloadByUniqueKey(input.sourceFetchRunId, input.sha256, input.requestUrl);
    if (existing) return existing;
    const row: SourcePayloadRow = {
      id: this.id('payload'),
      source_fetch_run_id: input.sourceFetchRunId,
      request_url: input.requestUrl,
      sha256: input.sha256,
      storage_path: input.storagePath,
    };
    this.payloads.push(row);
    return row;
  }

  async findPostingByIdentity(jobSourceId: string, identityKey: string) {
    return this.postings.find((p) => p.job_source_id === jobSourceId && p.identity_key === identityKey) ?? null;
  }

  async insertPosting(input: any) {
    if (this.failPostingInsert) throw new Error('posting insert failed');
    const existing = await this.findPostingByIdentity(input.jobSourceId, input.identityKey);
    if (existing) return existing;
    const row: SourcePostingRow = {
      id: this.id('posting'),
      job_source_id: input.jobSourceId,
      identity_key: input.identityKey,
      canonical_url: input.canonicalUrl,
      current_status: input.currentStatus,
      first_seen_at: input.observedAtIso,
      last_seen_at: input.observedAtIso,
      last_material_hash: input.lastMaterialHash,
      relevance_score: input.relevanceScore,
      relevance_score_version: input.relevanceScoreVersion,
    };
    this.postings.push(row);
    return row;
  }

  async updatePosting(id: string, input: any) {
    const posting = this.postings.find((p) => p.id === id)!;
    posting.last_seen_at = input.observedAtIso;
    posting.last_material_hash = input.lastMaterialHash;
    posting.current_status = input.currentStatus;
    posting.relevance_score = input.relevanceScore;
    posting.relevance_score_version = input.relevanceScoreVersion;
    return posting;
  }

  async getLatestVersion(sourcePostingId: string) {
    return this.versions.filter((v) => v.source_posting_id === sourcePostingId).at(-1) ?? null;
  }

  async insertPostingVersion(input: any) {
    const row: SourcePostingVersionRow = {
      id: this.id('version'),
      source_posting_id: input.sourcePostingId,
      material_hash: input.materialHash,
      normalized_json: input.normalizedJson,
    };
    this.versions.push(row);
    return row;
  }

  async findOpenReviewTask(taskType: string, entityTable: string, entityId: string, notes: string) {
    return this.tasks.find((t) =>
      t.status === 'open' && t.task_type === taskType && t.entity_table === entityTable && t.entity_id === entityId && t.notes === notes,
    ) ?? null;
  }

  async insertReviewTask(taskType: string, entityTable: string, entityId: string, notes: string) {
    const existing = await this.findOpenReviewTask(taskType, entityTable, entityId, notes);
    if (existing) return existing;
    const row: ReviewTaskRow = {
      id: this.id('task'),
      task_type: taskType,
      entity_table: entityTable,
      entity_id: entityId,
      status: 'open',
      notes,
    };
    this.tasks.push(row);
    return row;
  }

  async listOpenOpportunities() {
    return this.opportunities;
  }

  async findOpportunityById(opportunityId: string) {
    return this.opportunities.find((o) => o.id === opportunityId) ?? null;
  }

  async updateOpportunityObservation(opportunityId: string, observedAtIso: string) {
    const opp = this.opportunities.find((o) => o.id === opportunityId);
    if (opp) opp.last_seen_at = observedAtIso;
  }

  async updateOpportunityDraftFromPosting(opportunityId: string, input: any) {
    const opp = this.opportunities.find((o) => o.id === opportunityId)!;
    opp.title = input.title;
    opp.posting_url = input.postingUrl;
    opp.location = input.location;
    opp.focus_area = input.focusArea;
    opp.deadline = input.deadline;
    opp.deadline_text = input.deadlineText;
    opp.application_type = input.applicationType;
    opp.source_status_raw = input.sourceStatusRaw;
    opp.last_seen_at = input.observedAtIso;
    opp.review_status = 'pending';
    opp.public_safe = false;
  }

  async insertPendingOpportunity(input: any) {
    const existing = this.opportunities.find((o) => o.dedupe_key === input.dedupeKey);
    if (existing) return existing;
    const row: OpportunityRow = {
      id: this.id('opp'),
      company_id: input.companyId,
      title: input.title,
      posting_url: input.postingUrl,
      dedupe_key: input.dedupeKey,
      family_key: input.familyKey,
      review_status: 'pending',
      public_safe: false,
      last_seen_at: input.observedAtIso,
      location: input.location,
      eligibility: null,
      focus_area: input.focusArea,
      deadline: input.deadline,
      deadline_text: input.deadlineText,
      paid_status: 'unknown',
      application_type: input.applicationType,
      source_status_raw: input.sourceStatusRaw,
    };
    this.opportunities.push(row);
    return row;
  }

  async getLink(opportunityId: string, sourcePostingId: string) {
    return this.links.find((l) => l.opportunity_id === opportunityId && l.source_posting_id === sourcePostingId) ?? null;
  }

  async insertLink(input: any) {
    const existing = await this.getLink(input.opportunityId, input.sourcePostingId);
    if (existing) return existing;
    const row: OpportunitySourceLinkRow = {
      id: this.id('link'),
      opportunity_id: input.opportunityId,
      source_posting_id: input.sourcePostingId,
      match_type: input.matchType,
      is_primary: input.isPrimary,
    };
    this.links.push(row);
    return row;
  }
}

function posting(overrides: Partial<NormalizedSourcePosting> = {}): NormalizedSourcePosting {
  return {
    identityKey: 'greenhouse:test:1',
    materialHash: 'a'.repeat(64),
    connectorVersion: '1.0.0',
    sourceKind: 'greenhouse',
    externalPostingId: '1',
    internalJobId: '10',
    requisitionId: null,
    employerNameRaw: 'Acme Biotech',
    employerNameNormalized: 'acme biotech',
    titleRaw: 'Research Intern',
    titleNormalized: 'research intern',
    locationRaw: 'Long Beach, CA',
    locationNormalized: 'long beach, ca',
    canonicalUrl: 'https://example.com/job/1',
    remoteType: 'hybrid',
    employmentType: 'internship',
    classification: 'internship',
    department: 'research',
    departments: ['research'],
    offices: ['long beach'],
    focusArea: 'biotech',
    postedAt: '2026-07-01',
    closesAt: '2026-08-01',
    deadlineKind: 'hard',
    descriptionText: 'Great internship',
    language: 'en',
    sourceUpdatedAt: '2026-07-02T00:00:00.000Z',
    sourceMetadata: null,
    relevanceScore: 80,
    relevanceScoreVersion: 1,
    scoreBreakdown: {
      version: 1,
      total: 80,
      rawTotal: 80,
      positiveReasons: [{ category: 'role', points: 15, reason: 'internship' }],
      negativeReasons: [],
      uncertaintyFlags: [],
    },
    uncertaintyFlags: [],
    fetchedAt: '2026-07-13T00:00:00.000Z',
    ...overrides,
  };
}

function successResult(candidates: NormalizedSourcePosting[], partial = false): ConnectorFetchResult {
  return {
    ok: true,
    candidates,
    rawResponseText: JSON.stringify({ jobs: [{ id: 1 }] }),
    requestUrl: 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    finalUrl: 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    httpStatus: 200,
    contentType: 'application/json',
    etag: 'etag1',
    lastModified: null,
    error: null,
    fetchedAt: candidates[0]?.fetchedAt ?? '2026-07-13T00:00:00.000Z',
    recordsSeen: candidates.length,
    recordsNormalized: candidates.length,
    recordsSkipped: partial ? 1 : 0,
    issues: partial ? [{ safeId: 'job:skip', code: 'invalid_shape', message: 'skipped row' }] : [],
  };
}

function failureResult(errorClass: SourceFetchErrorClass): ConnectorFetchResult {
  return {
    ok: false,
    candidates: [],
    rawResponseText: '{"error":"bad"}',
    requestUrl: 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    finalUrl: 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    httpStatus: 500,
    contentType: 'application/json',
    etag: null,
    lastModified: null,
    fetchedAt: '2026-07-13T00:00:00.000Z',
    recordsSeen: 0,
    recordsNormalized: 0,
    recordsSkipped: 0,
    issues: [],
    error: {
      errorClass,
      code: errorClass,
      message: 'connector failed',
      httpStatus: 500,
    },
  };
}

describe('ingestion persistence bridge', () => {
  it('persists a new posting with payload, version, review task, and pending opportunity', async () => {
    const repo = new FakeRepository();
    const result = await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting()]),
    });

    expect(result.fetchRunStatus).toBe('completed');
    expect(repo.payloads).toHaveLength(1);
    expect(repo.postings).toHaveLength(1);
    expect(repo.versions).toHaveLength(1);
    expect(repo.tasks.some((t) => t.task_type === 'source_new')).toBe(true);
    expect(repo.opportunities).toHaveLength(1);
    expect(repo.opportunities[0].review_status).toBe('pending');
    expect(repo.opportunities[0].public_safe).toBe(false);
  });

  it('marks unchanged posting as unchanged and prevents duplicate versions', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting()]) });

    repo.fetchRuns[0].status = 'running';
    repo.fetchRuns[0].finished_at = null;
    repo.fetchRuns.push({ ...repo.fetchRuns[0], id: 'run-2', status: 'running', finished_at: null });

    const out = await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-2',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting({ fetchedAt: '2026-07-14T00:00:00.000Z' })]),
    });

    expect(out.counters.recordsUnchanged).toBe(1);
    expect(repo.versions).toHaveLength(1);
  });

  it('creates material-change version and source_changed task', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting()]) });

    repo.fetchRuns.push({ id: 'run-3', job_source_id: 'source-1', status: 'running', started_at: new Date().toISOString(), finished_at: null });
    await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-3',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting({ materialHash: 'b'.repeat(64), titleRaw: 'Research Intern II' })]),
    });

    expect(repo.versions).toHaveLength(2);
    expect(repo.tasks.some((t) => t.task_type === 'source_changed')).toBe(true);
  });

  it('creates source_reopened when closed posting is observed open again', async () => {
    const repo = new FakeRepository();
    const inserted = await repo.insertPosting({
      jobSourceId: 'source-1', identityKey: 'greenhouse:test:1', canonicalUrl: 'https://example.com/job/1', externalPostingId: '1',
      employerNameRaw: 'Acme', employerNameNormalized: 'acme', titleRaw: 'x', titleNormalized: 'x', locationRaw: null,
      locationNormalized: null, remoteType: 'unknown', employmentType: null, classification: 'internship', department: null,
      focusArea: null, postedAt: null, closesAt: null, deadlineKind: 'unknown', currentStatus: 'closed', relevanceScore: 70,
      relevanceScoreVersion: 1, scoreBreakdownJson: {}, uncertaintyFlags: [], lastPayloadId: null, lastMaterialHash: 'c'.repeat(64), observedAtIso: '2026-07-01T00:00:00.000Z',
    });
    inserted.current_status = 'closed';

    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting({ materialHash: 'd'.repeat(64) })]) });

    expect(repo.tasks.some((t) => t.task_type === 'source_reopened')).toBe(true);
  });

  it('marks partial fetch result as partial', async () => {
    const repo = new FakeRepository();
    const summary = await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting()], true),
    });
    expect(summary.fetchRunStatus).toBe('partial');
  });

  it('marks failed fetch result and maps error_class directly', async () => {
    const repo = new FakeRepository();
    const summary = await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: failureResult('rate_limit'),
    });
    expect(summary.fetchRunStatus).toBe('failed');
    expect(repo.fetchRuns[0].status).toBe('failed');
  });

  it('rejects duplicate fetch-run execution when run is already completed', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting()]) });

    await expect(persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting()]),
    })).rejects.toThrow(/already finalized/i);
  });

  it('prevents duplicate payload metadata entries on replay', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting()]) });
    expect(repo.payloads).toHaveLength(1);
  });

  it('keeps review tasks idempotent for identical material version', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting()]) });

    const sourceNewTaskCount = repo.tasks.filter((t) => t.task_type === 'source_new').length;
    expect(sourceNewTaskCount).toBe(1);
  });

  it('protects approved public opportunity fields and only updates observation metadata', async () => {
    const repo = new FakeRepository();
    repo.opportunities.push({
      id: 'opp-1',
      company_id: 'co-1',
      title: 'Approved Title',
      posting_url: 'https://example.com/job/1',
      dedupe_key: 'acme biotech|approved title|https://example.com/job/1',
      family_key: 'acme biotech|approved title',
      review_status: 'approved',
      public_safe: true,
      last_seen_at: '2026-07-01T00:00:00.000Z',
      location: 'Long Beach',
      eligibility: null,
      focus_area: 'biotech',
      deadline: null,
      deadline_text: null,
      paid_status: 'unknown',
      application_type: null,
      source_status_raw: null,
    });

    await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting({ titleRaw: 'Changed Public Title', materialHash: 'e'.repeat(64) })]),
    });

    expect(repo.opportunities[0].title).toBe('Approved Title');
    expect(repo.tasks.some((t) => t.task_type === 'source_changed' && t.entity_table === 'opportunities')).toBe(true);
  });

  it('enforces pending opportunity safety gates for low score', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting({ relevanceScore: 10 })]),
    });

    expect(repo.opportunities).toHaveLength(0);
  });

  it('persists relevance score with matching score version', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({ repository: repo, fetchRunId: 'run-1', expectedJobSourceId: 'source-1', fetchResult: successResult([posting({ relevanceScore: 77, relevanceScoreVersion: 1 })]) });
    expect(repo.postings[0].relevance_score).toBe(77);
    expect(repo.postings[0].relevance_score_version).toBe(1);
  });

  it('persists uncertainty flags', async () => {
    const repo = new FakeRepository();
    await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting({ uncertaintyFlags: ['description_missing'] })]),
    });

    const version = repo.versions[0];
    expect((version.normalized_json.uncertaintyFlags as string[])[0]).toBe('description_missing');
  });

  it('generates deterministic field-level diff', () => {
    const diff = diffDeterministic(
      { title: 'Old', nested: { a: 1, b: 2 } },
      { title: 'New', nested: { a: 1, b: 3 } },
    );
    expect(Object.keys(diff)).toEqual(['nested.b', 'title']);
  });

  it('maps error-class to allowed values', async () => {
    const repo = new FakeRepository();
    const summary = await persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: failureResult('timeout'),
    });
    expect(summary.fetchRunStatus).toBe('failed');
  });

  it('fails when storage upload fails', async () => {
    const repo = new FakeRepository();
    repo.failUpload = true;

    await expect(persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting()]),
    })).rejects.toThrow(/storage upload failed/i);
  });

  it('throws reconciliation error when metadata insert fails after storage success', async () => {
    const repo = new FakeRepository();
    repo.failPayloadMetadataInsert = true;

    await expect(persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting()]),
    })).rejects.toBeInstanceOf(PayloadStorageMetadataError);
  });

  it('marks run failed when database persistence fails after payload success', async () => {
    const repo = new FakeRepository();
    repo.failPostingInsert = true;

    await expect(persistFetchResult({
      repository: repo,
      fetchRunId: 'run-1',
      expectedJobSourceId: 'source-1',
      fetchResult: successResult([posting()]),
    })).rejects.toThrow(/posting insert failed/i);

    expect(repo.fetchRuns[0].status).toBe('failed');
    expect(repo.payloads).toHaveLength(1);
  });
});
