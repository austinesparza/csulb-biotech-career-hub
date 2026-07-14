import { describe, it, expect, vi } from 'vitest';
import {
  runAltosLabsPilotCore,
  enrichFetchResult,
  ALTOS_BOARD_TOKEN,
  ALTOS_EMPLOYER_NAME,
  type PilotGateway,
  type PilotJobSourceRow,
  type JobSourceHealthUpdate,
} from '../../lib/ingestion/manual-ingestion-pilot';
import type {
  ConnectorFetchResult,
  NormalizedSourcePosting,
} from '../../lib/ingestion/types';
import type { PersistFetchResultSummary } from '../../lib/ingestion/persistence';

// ============================================================
// HELPERS AND FIXTURES
// ============================================================

const BASE_SOURCE: PilotJobSourceRow = {
  id: 'source-altos-1',
  source_record_id: 'sr-altos-1',
  company_id: 'co-altos-1',
  source_kind: 'greenhouse',
  source_identifier: ALTOS_BOARD_TOKEN,
  enabled: true,
  automatic_scheduling_paused_at: null,
  config_json: { boardToken: ALTOS_BOARD_TOKEN, employerName: ALTOS_EMPLOYER_NAME, mode: 'manual_pilot' },
};

const FETCH_RUN_ID = 'run-pilot-1';

function makeCandidate(overrides: Partial<NormalizedSourcePosting> = {}): NormalizedSourcePosting {
  return {
    identityKey: `greenhouse:${ALTOS_BOARD_TOKEN}:1001`,
    materialHash: 'a'.repeat(64),
    connectorVersion: '1.0.0',
    sourceKind: 'greenhouse',
    externalPostingId: '1001',
    internalJobId: '5001',
    requisitionId: null,
    employerNameRaw: null,
    employerNameNormalized: null,
    titleRaw: 'Research Scientist',
    titleNormalized: 'research scientist',
    locationRaw: 'San Francisco, CA',
    locationNormalized: 'san francisco, ca',
    canonicalUrl: 'https://boards.greenhouse.io/altoslabs/jobs/1001',
    remoteType: 'onsite',
    employmentType: null,
    classification: 'entry_level',
    department: 'Research',
    departments: ['Research'],
    offices: ['San Francisco'],
    focusArea: 'cell biology',
    postedAt: '2026-07-01',
    closesAt: null,
    deadlineKind: 'rolling',
    descriptionText: 'Great research position at Altos Labs.',
    language: 'en',
    sourceUpdatedAt: '2026-07-01T00:00:00.000Z',
    sourceMetadata: null,
    relevanceScore: 75,
    relevanceScoreVersion: 1,
    scoreBreakdown: {
      version: 1,
      total: 75,
      rawTotal: 75,
      positiveReasons: [{ category: 'role', points: 20, reason: 'research' }],
      negativeReasons: [],
      uncertaintyFlags: ['employer_name_missing'],
    },
    uncertaintyFlags: ['employer_name_missing'],
    fetchedAt: '2026-07-14T00:00:00.000Z',
    ...overrides,
  };
}

function makeSuccessResult(candidates: NormalizedSourcePosting[]): ConnectorFetchResult {
  return {
    ok: true,
    candidates,
    rawResponseText: JSON.stringify({ jobs: candidates.map((c) => ({ id: c.externalPostingId })) }),
    requestUrl: `https://boards-api.greenhouse.io/v1/boards/${ALTOS_BOARD_TOKEN}/jobs?content=true`,
    finalUrl: `https://boards-api.greenhouse.io/v1/boards/${ALTOS_BOARD_TOKEN}/jobs?content=true`,
    httpStatus: 200,
    contentType: 'application/json',
    etag: null,
    lastModified: null,
    fetchedAt: '2026-07-14T00:00:00.000Z',
    recordsSeen: candidates.length,
    recordsNormalized: candidates.length,
    recordsSkipped: 0,
    issues: [],
    error: null,
  };
}

function makeFailureResult(): ConnectorFetchResult {
  return {
    ok: false,
    candidates: [],
    rawResponseText: null,
    requestUrl: `https://boards-api.greenhouse.io/v1/boards/${ALTOS_BOARD_TOKEN}/jobs?content=true`,
    finalUrl: null,
    httpStatus: 500,
    contentType: null,
    etag: null,
    lastModified: null,
    fetchedAt: '2026-07-14T00:00:00.000Z',
    recordsSeen: 0,
    recordsNormalized: 0,
    recordsSkipped: 0,
    issues: [],
    error: { errorClass: 'unexpected', code: 'server_error', message: 'Internal server error', httpStatus: 500 },
  };
}

function makeSuccessSummary(overrides: Partial<PersistFetchResultSummary> = {}): PersistFetchResultSummary {
  return {
    fetchRunId: FETCH_RUN_ID,
    fetchRunStatus: 'completed',
    payloadId: 'payload-1',
    payloadInserted: true,
    counters: { recordsNew: 1, recordsChanged: 0, recordsUnchanged: 0, recordsReviewed: 1, recordsClosedCandidates: 0 },
    ...overrides,
  };
}

// ============================================================
// FAKE GATEWAY
// ============================================================

class FakePilotGateway implements PilotGateway {
  source: PilotJobSourceRow | null = { ...BASE_SOURCE };
  activeFetchRun: { id: string; status: string } | null = null;
  fetchRunId = FETCH_RUN_ID;
  healthUpdates: (JobSourceHealthUpdate & { sourceId: string })[] = [];
  finalizedRuns: Array<{ fetchRunId: string; errorMessage: string }> = [];
  persistSummary: PersistFetchResultSummary = makeSuccessSummary();
  persistThrows: Error | null = null;
  persistedResult: ConnectorFetchResult | null = null;

  async findJobSource() {
    return this.source;
  }

  async findActiveFetchRun(_jobSourceId: string) {
    return this.activeFetchRun;
  }

  async insertFetchRun(_params: { jobSourceId: string; workerId: string; nowIso: string }) {
    return this.fetchRunId;
  }

  async updateJobSourceHealth(sourceId: string, update: JobSourceHealthUpdate) {
    this.healthUpdates.push({ sourceId, ...update });
  }

  async finalizeFetchRunFailed(params: {
    fetchRunId: string;
    httpStatus: number | null;
    recordsSeen: number;
    errorMessage: string;
    logJson: Record<string, unknown>;
    finishedAtIso: string;
  }) {
    this.finalizedRuns.push({ fetchRunId: params.fetchRunId, errorMessage: params.errorMessage });
  }

  async persistResult(p: { fetchRunId: string; sourceId: string; result: ConnectorFetchResult }) {
    this.persistedResult = p.result;
    if (this.persistThrows) throw this.persistThrows;
    return this.persistSummary;
  }
}

// ============================================================
// TESTS: enrichFetchResult
// ============================================================

describe('enrichFetchResult', () => {
  it('adds employer name and removes employer_name_missing flag from candidates', () => {
    const candidate = makeCandidate();
    expect(candidate.employerNameRaw).toBeNull();
    expect(candidate.uncertaintyFlags).toContain('employer_name_missing');
    expect(candidate.scoreBreakdown.uncertaintyFlags).toContain('employer_name_missing');

    const result = makeSuccessResult([candidate]);
    const enriched = enrichFetchResult(result);

    expect(enriched.ok).toBe(true);
    if (!enriched.ok) throw new Error('expected ok');
    const enrichedCandidate = enriched.candidates[0];
    expect(enrichedCandidate.employerNameRaw).toBe(ALTOS_EMPLOYER_NAME);
    expect(enrichedCandidate.employerNameNormalized).toBe('altos labs');
    expect(enrichedCandidate.uncertaintyFlags).not.toContain('employer_name_missing');
    expect(enrichedCandidate.scoreBreakdown.uncertaintyFlags).not.toContain('employer_name_missing');
  });

  it('does not mutate the original result or candidates', () => {
    const candidate = makeCandidate();
    const originalFlags = [...candidate.uncertaintyFlags];
    const result = makeSuccessResult([candidate]);
    enrichFetchResult(result);
    expect(candidate.uncertaintyFlags).toEqual(originalFlags);
    expect(result.candidates[0]).toBe(candidate);
  });

  it('passes failure results through unchanged', () => {
    const failure = makeFailureResult();
    const enriched = enrichFetchResult(failure);
    expect(enriched).toBe(failure);
  });
});

// ============================================================
// TESTS: runAltosLabsPilotCore — validation
// ============================================================

describe('runAltosLabsPilotCore — source validation', () => {
  it('throws when source is not found', async () => {
    const gateway = new FakePilotGateway();
    gateway.source = null;
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('throws when source is disabled', async () => {
    const gateway = new FakePilotGateway();
    gateway.source = { ...BASE_SOURCE, enabled: false };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /disabled/i,
    );
  });

  it('throws when automatic_scheduling_paused_at is set', async () => {
    const gateway = new FakePilotGateway();
    gateway.source = { ...BASE_SOURCE, automatic_scheduling_paused_at: '2026-07-01T00:00:00Z' };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /paused/i,
    );
  });

  it('throws when config_json.boardToken is not altoslabs', async () => {
    const gateway = new FakePilotGateway();
    gateway.source = {
      ...BASE_SOURCE,
      config_json: { ...BASE_SOURCE.config_json, boardToken: 'wrongcompany' },
    };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /boardToken/i,
    );
  });

  it('throws when source has no company_id', async () => {
    const gateway = new FakePilotGateway();
    gateway.source = { ...BASE_SOURCE, company_id: null };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /company_id/i,
    );
  });

  it('throws when source has no source_record_id', async () => {
    const gateway = new FakePilotGateway();
    gateway.source = { ...BASE_SOURCE, source_record_id: null };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /source_record_id/i,
    );
  });

  it('throws when a pending run already exists', async () => {
    const gateway = new FakePilotGateway();
    gateway.activeFetchRun = { id: 'run-existing', status: 'pending' };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /pending/i,
    );
  });

  it('throws when a running run already exists', async () => {
    const gateway = new FakePilotGateway();
    gateway.activeFetchRun = { id: 'run-existing', status: 'running' };
    await expect(runAltosLabsPilotCore({ gateway, workerId: 'officer:u1' })).rejects.toThrow(
      /running/i,
    );
  });
});

// ============================================================
// TESTS: runAltosLabsPilotCore — successful fetch and persistence
// ============================================================

describe('runAltosLabsPilotCore — successful fetch', () => {
  it('returns a complete summary with correct counters on success', async () => {
    const gateway = new FakePilotGateway();
    const candidate = makeCandidate();
    const fetchResult = makeSuccessResult([candidate]);
    const fetchJobs = vi.fn().mockResolvedValue(fetchResult);

    const summary = await runAltosLabsPilotCore({ gateway, fetchJobs, workerId: 'officer:u1' });

    expect(summary.fetchRunId).toBe(FETCH_RUN_ID);
    expect(summary.status).toBe('completed');
    expect(summary.recordsSeen).toBe(1);
    expect(summary.recordsNew).toBe(1);
    expect(summary.payloadStored).toBe(true);
    expect(summary.errorMessage).toBeNull();
  });

  it('calls fetchJobs with the fixed ALTOS_BOARD_TOKEN only', async () => {
    const gateway = new FakePilotGateway();
    const fetchJobs = vi.fn().mockResolvedValue(makeSuccessResult([]));

    await runAltosLabsPilotCore({ gateway, fetchJobs, workerId: 'officer:u1' });

    expect(fetchJobs).toHaveBeenCalledOnce();
    expect(fetchJobs).toHaveBeenCalledWith({ boardToken: ALTOS_BOARD_TOKEN });
  });

  it('enriches employer name before calling persistResult', async () => {
    const gateway = new FakePilotGateway();
    const candidate = makeCandidate();
    expect(candidate.employerNameRaw).toBeNull();

    await runAltosLabsPilotCore({
      gateway,
      fetchJobs: vi.fn().mockResolvedValue(makeSuccessResult([candidate])),
      workerId: 'officer:u1',
    });

    const passedResult = gateway.persistedResult;
    expect(passedResult).not.toBeNull();
    expect(passedResult!.ok).toBe(true);
    if (!passedResult!.ok) throw new Error('expected ok');
    expect(passedResult!.candidates[0].employerNameRaw).toBe(ALTOS_EMPLOYER_NAME);
    expect(passedResult!.candidates[0].employerNameNormalized).toBe('altos labs');
    expect(passedResult!.candidates[0].uncertaintyFlags).not.toContain('employer_name_missing');
  });

  it('updates health with success=true on completed status', async () => {
    const gateway = new FakePilotGateway();
    await runAltosLabsPilotCore({
      gateway,
      fetchJobs: vi.fn().mockResolvedValue(makeSuccessResult([])),
      workerId: 'officer:u1',
    });

    const healthUpdate = gateway.healthUpdates.find((u) => u.success === true);
    expect(healthUpdate).toBeDefined();
    expect(healthUpdate!.sourceId).toBe(BASE_SOURCE.id);
  });

  it('passes a connector failure result to persistResult for consistent finalization', async () => {
    const gateway = new FakePilotGateway();
    gateway.persistSummary = {
      fetchRunId: FETCH_RUN_ID,
      fetchRunStatus: 'failed',
      payloadId: null,
      payloadInserted: false,
      counters: { recordsNew: 0, recordsChanged: 0, recordsUnchanged: 0, recordsReviewed: 0, recordsClosedCandidates: 0 },
    };
    const failResult = makeFailureResult();

    const summary = await runAltosLabsPilotCore({
      gateway,
      fetchJobs: vi.fn().mockResolvedValue(failResult),
      workerId: 'officer:u1',
    });

    // The connector failure is still passed to persistResult
    expect(gateway.persistedResult).not.toBeNull();
    expect(gateway.persistedResult!.ok).toBe(false);
    expect(summary.status).toBe('failed');
  });
});

// ============================================================
// TESTS: runAltosLabsPilotCore — persistence exception
// ============================================================

describe('runAltosLabsPilotCore — persistence exception', () => {
  it('finalizes the run as failed and returns a failed summary when persistResult throws', async () => {
    const gateway = new FakePilotGateway();
    gateway.persistThrows = new Error('database connection lost');

    const summary = await runAltosLabsPilotCore({
      gateway,
      fetchJobs: vi.fn().mockResolvedValue(makeSuccessResult([])),
      workerId: 'officer:u1',
    });

    expect(summary.status).toBe('failed');
    expect(summary.errorMessage).toContain('database connection lost');
    expect(gateway.finalizedRuns).toHaveLength(1);
    expect(gateway.finalizedRuns[0].fetchRunId).toBe(FETCH_RUN_ID);
  });

  it('updates health with success=false on persistence exception', async () => {
    const gateway = new FakePilotGateway();
    gateway.persistThrows = new Error('unexpected failure');

    await runAltosLabsPilotCore({
      gateway,
      fetchJobs: vi.fn().mockResolvedValue(makeSuccessResult([])),
      workerId: 'officer:u1',
    });

    const failureUpdate = gateway.healthUpdates.find((u) => u.success === false);
    expect(failureUpdate).toBeDefined();
  });
});

// ============================================================
// TESTS: returned summary contains no raw response body
// ============================================================

describe('runAltosLabsPilotCore — summary safety', () => {
  it('returned summary does not contain rawResponseText or raw payloads', async () => {
    const gateway = new FakePilotGateway();
    const summary = await runAltosLabsPilotCore({
      gateway,
      fetchJobs: vi.fn().mockResolvedValue(makeSuccessResult([makeCandidate()])),
      workerId: 'officer:u1',
    });

    const summaryJson = JSON.stringify(summary);
    expect(summaryJson).not.toContain('rawResponseText');
    expect(summaryJson).not.toContain('candidates');
    expect(summaryJson).not.toContain('"ok"');

    // Only the allowed summary fields are present
    const keys = Object.keys(summary);
    expect(keys).toContain('fetchRunId');
    expect(keys).toContain('status');
    expect(keys).toContain('recordsSeen');
    expect(keys).toContain('recordsNormalized');
    expect(keys).toContain('recordsSkipped');
    expect(keys).toContain('recordsNew');
    expect(keys).toContain('recordsChanged');
    expect(keys).toContain('recordsUnchanged');
    expect(keys).toContain('recordsReviewed');
    expect(keys).toContain('payloadStored');
    expect(keys).toContain('errorMessage');
    expect(keys).toHaveLength(11);
  });
});
