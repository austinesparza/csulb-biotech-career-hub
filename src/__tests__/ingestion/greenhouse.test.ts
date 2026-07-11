import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateBoardToken,
  buildGreenhouseUrl,
  normalizeGreenhouseJob,
  fetchGreenhouseJobs,
  CONNECTOR_VERSION,
} from '../../lib/ingestion/connectors/greenhouse';
import { SCORE_VERSION } from '../../lib/ingestion/score';

// ============================================================
// HELPERS — load fixtures without live network
// ============================================================

const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

/** Create a mock fetch that returns a fixed body with given status. */
function mockFetch(
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): typeof fetch {
  return (_url: RequestInfo | URL, _init?: RequestInit) => {
    const response = new Response(body, {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...headers,
      },
    });
    return Promise.resolve(response);
  };
}

/** Create a mock fetch that rejects with an abort error. */
function mockTimeout(): typeof fetch {
  return (_url: RequestInfo | URL, _init?: RequestInit) => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    return Promise.reject(err);
  };
}

/** Create a mock fetch that rejects with a network error. */
function mockNetworkError(): typeof fetch {
  return (_url: RequestInfo | URL, _init?: RequestInit) => {
    return Promise.reject(new TypeError('fetch failed'));
  };
}

// ============================================================
// BOARD TOKEN VALIDATION
// ============================================================

describe('validateBoardToken', () => {
  it('accepts valid board tokens', () => {
    expect(validateBoardToken('mycompany').valid).toBe(true);
    expect(validateBoardToken('my-company').valid).toBe(true);
    expect(validateBoardToken('my_company_123').valid).toBe(true);
    expect(validateBoardToken('a').valid).toBe(true);
  });

  it('rejects empty tokens', () => {
    expect(validateBoardToken('').valid).toBe(false);
    expect(validateBoardToken('   ').valid).toBe(false);
  });

  it('rejects tokens with invalid characters', () => {
    expect(validateBoardToken('my company').valid).toBe(false); // space
    expect(validateBoardToken('my/company').valid).toBe(false); // slash
    expect(validateBoardToken('my.company').valid).toBe(false); // dot
    expect(validateBoardToken('../evil').valid).toBe(false);    // path traversal
  });

  it('rejects tokens starting with hyphen', () => {
    expect(validateBoardToken('-mycompany').valid).toBe(false);
  });

  it('rejects tokens longer than 128 characters', () => {
    expect(validateBoardToken('a'.repeat(129)).valid).toBe(false);
  });

  it('accepts mixed case tokens', () => {
    expect(validateBoardToken('MyCompany').valid).toBe(true);
  });
});

// ============================================================
// URL CONSTRUCTION
// ============================================================

describe('buildGreenhouseUrl', () => {
  it('builds the correct Greenhouse API URL', () => {
    const url = buildGreenhouseUrl('mycompany');
    expect(url).toBe('https://boards-api.greenhouse.io/v1/boards/mycompany/jobs?content=true');
  });

  it('always uses the internal Greenhouse base URL', () => {
    const url = buildGreenhouseUrl('any-token');
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('boards-api.greenhouse.io');
    expect(parsed.protocol).toBe('https:');
  });
});

// ============================================================
// JOB NORMALIZATION
// ============================================================

describe('normalizeGreenhouseJob', () => {
  const BOARD_TOKEN = 'labgenomicsinc';
  const FETCHED_AT = '2026-07-11T00:00:00.000Z';

  const NORMAL_FIXTURE_DATA = JSON.parse(loadFixture('greenhouse-normal.json'));
  const INTERNSHIP_JOB = NORMAL_FIXTURE_DATA.jobs[0]; // Biotechnology Intern

  it('produces a stable identity key', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.identityKey).toBe('greenhouse:labgenomicsinc:1001001');
  });

  it('identity key does not change when title changes', () => {
    const modifiedJob = { ...INTERNSHIP_JOB, title: 'Changed Title' };
    const original = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    const modified = normalizeGreenhouseJob(modifiedJob, BOARD_TOKEN, FETCHED_AT);
    expect(original.identityKey).toBe(modified.identityKey);
  });

  it('identity key does not change when fetchedAt changes', () => {
    const a = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, '2026-07-01T00:00:00Z');
    const b = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, '2026-07-11T00:00:00Z');
    expect(a.identityKey).toBe(b.identityKey);
  });

  it('material hash changes when title changes', () => {
    const changedTitleFixture = JSON.parse(loadFixture('greenhouse-changed-title.json'));
    const original = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    const changed = normalizeGreenhouseJob(changedTitleFixture.jobs[0], BOARD_TOKEN, FETCHED_AT);
    expect(original.materialHash).not.toBe(changed.materialHash);
  });

  it('material hash changes when deadline changes', () => {
    const changedDeadlineFixture = JSON.parse(loadFixture('greenhouse-changed-deadline.json'));
    const original = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    const changed = normalizeGreenhouseJob(changedDeadlineFixture.jobs[0], BOARD_TOKEN, FETCHED_AT);
    expect(original.materialHash).not.toBe(changed.materialHash);
  });

  it('material hash does NOT change for key-order-only differences', () => {
    const sameContentFixture = JSON.parse(loadFixture('greenhouse-same-content-different-key-order.json'));
    // Both fixtures have the same material data for job 1001001
    const a = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    const b = normalizeGreenhouseJob(sameContentFixture.jobs[0], BOARD_TOKEN, FETCHED_AT);
    // Both have same title, location, deadline — hash should match
    expect(a.materialHash).toBe(b.materialHash);
  });

  it('material hash is exactly 64 lowercase hex characters', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.materialHash).toHaveLength(64);
    expect(posting.materialHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('connectorVersion is set', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.connectorVersion).toBe(CONNECTOR_VERSION);
    expect(posting.connectorVersion.trim()).not.toBe('');
  });

  it('sourceKind is greenhouse', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceKind).toBe('greenhouse');
  });

  it('score is within 0–100', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.relevanceScore).toBeGreaterThanOrEqual(0);
    expect(posting.relevanceScore).toBeLessThanOrEqual(100);
  });

  it('score and score version are both set (paired)', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.relevanceScore).not.toBeNull();
    expect(posting.relevanceScoreVersion).not.toBeNull();
    expect(posting.relevanceScoreVersion).toBe(SCORE_VERSION);
    expect(posting.relevanceScoreVersion).toBeGreaterThan(0);
  });

  it('score breakdown has version, total, positiveReasons, negativeReasons', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.scoreBreakdown.version).toBe(SCORE_VERSION);
    expect(typeof posting.scoreBreakdown.total).toBe('number');
    expect(Array.isArray(posting.scoreBreakdown.positiveReasons)).toBe(true);
    expect(Array.isArray(posting.scoreBreakdown.negativeReasons)).toBe(true);
  });

  it('uncertainty flags are an array', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(Array.isArray(posting.uncertaintyFlags)).toBe(true);
  });

  it('decodes HTML entities in title (entity not present in normalized form)', () => {
    const jobWithEntities = NORMAL_FIXTURE_DATA.jobs[5]; // "Biochemistry Lab Intern &amp; Research Assistant"
    const posting = normalizeGreenhouseJob(jobWithEntities, BOARD_TOKEN, FETCHED_AT);
    // The raw HTML entity must not appear in the normalized title
    expect(posting.titleNormalized).not.toContain('&amp;');
    // Core title words must be present
    expect(posting.titleNormalized).toContain('biochemistry');
    expect(posting.titleNormalized).toContain('intern');
  });

  it('sets location_missing flag for missing location', () => {
    const missingLocationJob = NORMAL_FIXTURE_DATA.jobs[5]; // location is null
    const posting = normalizeGreenhouseJob(missingLocationJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.uncertaintyFlags).toContain('location_missing');
  });

  it('sets description_missing flag for missing description', () => {
    const noDescJob = NORMAL_FIXTURE_DATA.jobs[6]; // content is null
    const posting = normalizeGreenhouseJob(noDescJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.uncertaintyFlags).toContain('description_missing');
  });

  it('sets deadline_invalid flag for malformed date', () => {
    const badDateJob = NORMAL_FIXTURE_DATA.jobs[6]; // application_deadline = "not-a-real-date"
    const posting = normalizeGreenhouseJob(badDateJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.uncertaintyFlags).toContain('deadline_invalid');
  });

  it('handles missing optional arrays (departments, offices)', () => {
    const missingArraysJob = NORMAL_FIXTURE_DATA.jobs[6]; // departments: null, offices: null
    const posting = normalizeGreenhouseJob(missingArraysJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.departments).toEqual([]);
    expect(posting.offices).toEqual([]);
  });

  it('classifies internship correctly', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.classification).toBe('internship');
  });

  it('classifies remote position correctly', () => {
    const remoteJob = NORMAL_FIXTURE_DATA.jobs[3]; // Remote
    const posting = normalizeGreenhouseJob(remoteJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.remoteType).toBe('remote');
  });

  it('classifies hybrid position correctly', () => {
    const hybridJob = NORMAL_FIXTURE_DATA.jobs[4]; // Hybrid
    const posting = normalizeGreenhouseJob(hybridJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.remoteType).toBe('hybrid');
  });

  it('handles multiple offices and departments', () => {
    const multiJob = NORMAL_FIXTURE_DATA.jobs[4]; // 2 departments, 2 offices
    const posting = normalizeGreenhouseJob(multiJob, BOARD_TOKEN, FETCHED_AT);
    expect(posting.departments.length).toBeGreaterThanOrEqual(2);
    expect(posting.offices.length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes is deterministic', () => {
    const a = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    const b = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(a.identityKey).toBe(b.identityKey);
    expect(a.materialHash).toBe(b.materialHash);
    expect(a.relevanceScore).toBe(b.relevanceScore);
  });

  it('employer_name_missing flag is set (employer not in job list endpoint)', () => {
    const posting = normalizeGreenhouseJob(INTERNSHIP_JOB, BOARD_TOKEN, FETCHED_AT);
    expect(posting.uncertaintyFlags).toContain('employer_name_missing');
    expect(posting.employerNameRaw).toBeNull();
    expect(posting.employerNameNormalized).toBeNull();
  });
});

// ============================================================
// CONNECTOR FETCH — uses mocked fetch (no live network)
// ============================================================

describe('fetchGreenhouseJobs', () => {
  it('returns normalized candidates from valid response', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.httpStatus).toBe(200);
  });

  it('preserves raw response text', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    expect(result.rawResponseText).not.toBeNull();
    // raw text should contain the original JSON
    expect(result.rawResponseText).toContain('"jobs"');
  });

  it('captures content type, etag, last-modified', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body, 200, {
        'etag': '"abc123"',
        'last-modified': 'Fri, 10 Jul 2026 10:00:00 GMT',
      }),
    });

    expect(result.contentType).toContain('application/json');
    expect(result.etag).toBe('"abc123"');
    expect(result.lastModified).toBe('Fri, 10 Jul 2026 10:00:00 GMT');
  });

  it('rejects invalid board token before making a request', async () => {
    let fetchCalled = false;
    const spy: typeof fetch = ((..._args) => {
      fetchCalled = true;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;

    const result = await fetchGreenhouseJobs({
      boardToken: '../evil/path',
      fetchFn: spy,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('schema');
    expect(fetchCalled).toBe(false);
  });

  it('handles HTTP 404', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'nonexistentboard',
      fetchFn: mockFetch('Not Found', 404, { 'content-type': 'text/plain' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('not_found');
    expect(result.error?.httpStatus).toBe(404);
    expect(result.httpStatus).toBe(404);
  });

  it('handles HTTP 429 rate limit', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Too Many Requests', 429, { 'content-type': 'text/plain' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('rate_limit');
    expect(result.error?.httpStatus).toBe(429);
  });

  it('handles HTTP 500 server error', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Internal Server Error', 500, { 'content-type': 'text/plain' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('server_error');
    expect(result.error?.httpStatus).toBe(500);
  });

  it('handles invalid JSON response', async () => {
    const invalidJson = loadFixture('greenhouse-invalid-json.txt');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(invalidJson),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('schema');
    // Raw text should be preserved for debugging
    expect(result.rawResponseText).not.toBeNull();
  });

  it('handles invalid response shape (missing jobs array)', async () => {
    const invalidShape = loadFixture('greenhouse-invalid-shape.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(invalidShape),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('schema');
  });

  it('handles empty jobs array', async () => {
    const empty = loadFixture('greenhouse-empty.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(empty),
    });

    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  it('handles timeout/abort error', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockTimeout(),
      timeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('timeout');
    expect(result.rawResponseText).toBeNull();
  });

  it('handles network error', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockNetworkError(),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('network');
  });

  it('handles oversized response', async () => {
    // Create a large body that exceeds the 1-byte limit we set for this test
    const oversizedBody = '{"jobs":' + JSON.stringify(new Array(10).fill({ id: 1, title: 'x'.repeat(1000) })) + '}';
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(oversizedBody),
      maxResponseBytes: 1, // tiny limit for testing
    });

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('oversized');
  });

  it('includes fetchedAt timestamp in result', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    expect(typeof result.fetchedAt).toBe('string');
    expect(new Date(result.fetchedAt).getTime()).not.toBeNaN();
  });

  it('sets requestUrl to the constructed Greenhouse URL', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    expect(result.requestUrl).toContain('boards-api.greenhouse.io');
    expect(result.requestUrl).toContain('labgenomicsinc');
    expect(result.requestUrl).toContain('content=true');
  });

  it('all candidates have deterministic scores within 0–100', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    for (const candidate of result.candidates) {
      expect(candidate.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(candidate.relevanceScore).toBeLessThanOrEqual(100);
    }
  });

  it('all candidates have score and score version paired', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    for (const candidate of result.candidates) {
      // Both must be non-null
      expect(candidate.relevanceScore).not.toBeNull();
      expect(candidate.relevanceScoreVersion).not.toBeNull();
      expect(candidate.relevanceScoreVersion).toBe(SCORE_VERSION);
    }
  });

  it('all candidates have valid 64-char material hashes', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });

    for (const candidate of result.candidates) {
      expect(candidate.materialHash).toHaveLength(64);
      expect(candidate.materialHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('does not make individual job-detail requests (no N+1)', async () => {
    let fetchCount = 0;
    const countingFetch: typeof fetch = (url, init) => {
      fetchCount++;
      return mockFetch(loadFixture('greenhouse-normal.json'))(url, init);
    };

    await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: countingFetch,
    });

    // Should only make exactly one request for the jobs list
    expect(fetchCount).toBe(1);
  });

  it('does not have no live network access (all fetches go through fetchFn)', async () => {
    // This test verifies the connector uses the injected fetchFn
    // so tests never touch the real Greenhouse API
    let usedFetchFn = false;
    const trackedFetch: typeof fetch = (url, init) => {
      usedFetchFn = true;
      return mockFetch(loadFixture('greenhouse-normal.json'))(url, init);
    };

    await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: trackedFetch,
    });

    expect(usedFetchFn).toBe(true);
  });
});
