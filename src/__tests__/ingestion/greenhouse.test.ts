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
    expect(result.error?.errorClass).toBe('schema');
    expect(fetchCalled).toBe(false);
  });

  it('handles HTTP 404', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'nonexistentboard',
      fetchFn: mockFetch('Not Found', 404, { 'content-type': 'text/plain' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('not_found');
    expect(result.error?.httpStatus).toBe(404);
    expect(result.httpStatus).toBe(404);
  });

  it('handles HTTP 429 rate limit', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Too Many Requests', 429, { 'content-type': 'text/plain' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('rate_limit');
    expect(result.error?.httpStatus).toBe(429);
  });

  it('handles HTTP 500 server error', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Internal Server Error', 500, { 'content-type': 'text/plain' }),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('server_error');
    expect(result.error?.httpStatus).toBe(500);
  });

  it('handles invalid JSON response', async () => {
    const invalidJson = loadFixture('greenhouse-invalid-json.txt');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(invalidJson),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('schema');
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
    expect(result.error?.errorClass).toBe('schema');
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
    expect(result.error?.errorClass).toBe('timeout');
    expect(result.rawResponseText).toBeNull();
  });

  it('handles network error', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockNetworkError(),
    });

    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('network');
  });

  it('handles oversized response', async () => {
    // Create a body that exceeds the minimum valid limit (1024 bytes)
    // The oversized body is ~10KB (10 * ~1020-char job objects)
    const oversizedBody = '{"jobs":' + JSON.stringify(new Array(10).fill({ id: 1, title: 'x'.repeat(1000) })) + '}';
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(oversizedBody),
      maxResponseBytes: 1024, // valid minimum — body exceeds this
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('response_oversized');
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

// ============================================================
// CONFIG VALIDATION — timeoutMs and maxResponseBytes bounds
// ============================================================

describe('fetchGreenhouseJobs config validation', () => {
  it('rejects zero timeoutMs', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: 0, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects negative timeoutMs', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: -1000, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects fractional timeoutMs', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: 1500.5, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects Infinity timeoutMs', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: Infinity, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects NaN timeoutMs', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: NaN, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects excessive timeoutMs (> 120000)', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: 200000, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('accepts timeoutMs at lower bound (100)', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: 100, fetchFn: mockFetch(body) });
    expect(result.ok).toBe(true);
  });

  it('accepts timeoutMs at upper bound (120000)', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', timeoutMs: 120000, fetchFn: mockFetch(body) });
    expect(result.ok).toBe(true);
  });

  it('rejects zero maxResponseBytes', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', maxResponseBytes: 0, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects negative maxResponseBytes', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', maxResponseBytes: -1, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects fractional maxResponseBytes', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', maxResponseBytes: 1024.5, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('rejects excessive maxResponseBytes (> 20 MiB)', async () => {
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', maxResponseBytes: 30 * 1024 * 1024, fetchFn: mockFetch('{}') });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('invalid_config');
  });

  it('accepts maxResponseBytes at lower bound (1024)', async () => {
    const body = loadFixture('greenhouse-empty.json');
    const result = await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', maxResponseBytes: 1024, fetchFn: mockFetch(body) });
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// REDIRECT POLICY — manual redirect mode
// ============================================================

describe('fetchGreenhouseJobs redirect policy', () => {
  it('uses redirect: manual (no second network request on 3xx)', async () => {
    let fetchCount = 0;
    const countingRedirectFetch: typeof fetch = (_url, init) => {
      fetchCount++;
      // Simulate a 301 redirect response (opaque redirect from manual mode)
      const response = new Response(null, {
        status: 301,
        headers: { Location: 'https://other-host.example.com/jobs' },
      });
      void init; // captures the redirect:manual option
      return Promise.resolve(response);
    };
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: countingRedirectFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('redirect_rejected');
    // Only one network request — no automatic redirect follow
    expect(fetchCount).toBe(1);
  });

  it('rejects 301 redirect', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('', 301),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('redirect_rejected');
    expect(result.error?.httpStatus).toBe(301);
  });

  it('rejects 302 redirect', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('', 302),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('redirect_rejected');
    expect(result.error?.httpStatus).toBe(302);
  });

  it('passes redirect: manual in fetch options', async () => {
    let capturedInit: RequestInit | undefined;
    const spyFetch: typeof fetch = (_url, init) => {
      capturedInit = init;
      return Promise.resolve(new Response(loadFixture('greenhouse-normal.json'), { status: 200 }));
    };
    await fetchGreenhouseJobs({ boardToken: 'labgenomicsinc', fetchFn: spyFetch });
    expect((capturedInit as RequestInit & { redirect?: string })?.redirect).toBe('manual');
  });
});

// ============================================================
// TIMEOUT — full operation timeout
// ============================================================

describe('fetchGreenhouseJobs full-operation timeout', () => {
  it('returns timeout error when body stream never completes', async () => {
    // Mock fetch that returns headers immediately but never resolves the body
    const hangingBodyFetch: typeof fetch = (_url, init) => {
      const { signal } = init as RequestInit;
      // Create a response with a body that never sends data
      const stream = new ReadableStream({
        start(_controller) {
          // Never enqueue or close — simulates a stalled body stream
          // The AbortSignal will eventually abort it
          if (signal) {
            signal.addEventListener('abort', () => {
              _controller.error(new DOMException('Aborted', 'AbortError'));
            });
          }
        },
      });
      const response = new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      return Promise.resolve(response);
    };

    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: hangingBodyFetch,
      timeoutMs: 200, // short timeout
    });

    expect(result.ok).toBe(false);
    // Must be exactly timeout — stream abort is always a timeout, not a network error
    expect(result.error?.errorClass).toBe('timeout');
  });
});

// ============================================================
// BOUNDED ERROR BODIES — non-2xx bodies are bounded
// ============================================================

describe('fetchGreenhouseJobs bounded error bodies', () => {
  const bigBody = 'x'.repeat(200_000); // 200KB body

  it('handles oversized 404 body without unbounded read', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(bigBody, 404, { 'content-type': 'text/plain' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('not_found');
    expect(result.error?.httpStatus).toBe(404);
  });

  it('handles oversized 429 body without unbounded read', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(bigBody, 429, { 'content-type': 'text/plain' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('rate_limit');
  });

  it('handles oversized 500 body without unbounded read', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(bigBody, 500, { 'content-type': 'text/plain' }),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('server_error');
  });
});

// ============================================================
// CANONICAL URL — no fabricated URLs, per-record issues
// ============================================================

describe('fetchGreenhouseJobs canonical URL handling', () => {
  it('skips records with missing absolute_url and returns ConnectorIssue', async () => {
    const bodyWithMissingUrl = JSON.stringify({
      jobs: [{
        id: 9001,
        title: 'Test Job',
        location: { name: 'Long Beach, CA' },
        absolute_url: null, // missing URL
        content: '<p>Test description</p>',
        departments: [],
        offices: [],
      }],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(bodyWithMissingUrl),
    });
    // 1 record seen, 0 normalized → all-invalid → ok: false
    expect(result.ok).toBe(false);
    expect(result.candidates).toHaveLength(0);
    expect(result.recordsSkipped).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].code).toBe('invalid_shape');
  });

  it('skips records with malformed absolute_url', async () => {
    const body = JSON.stringify({
      // :::bad is not a valid URL — new URL() will throw
      jobs: [{ id: 9002, title: 'Bad URL Job', absolute_url: ':::bad-url', content: '<p>desc</p>' }],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });
    expect(result.recordsSkipped).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('skips records with javascript: scheme absolute_url', async () => {
    const body = JSON.stringify({
      jobs: [{ id: 9003, title: 'XSS Job', absolute_url: 'javascript:alert(1)', content: '<p>desc</p>' }],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });
    expect(result.recordsSkipped).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('does NOT fabricate a canonical URL from the job ID', async () => {
    const body = JSON.stringify({
      jobs: [{ id: 9004, title: 'No URL Job', absolute_url: null, content: '<p>desc</p>' }],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });
    // Candidates must not contain a fabricated boards-api.greenhouse.io/jobs/{id} URL
    for (const c of result.candidates) {
      expect(c.canonicalUrl).not.toContain('boards-api.greenhouse.io/jobs/9004');
    }
  });
});

// ============================================================
// STRUCTURED ISSUES — mixed-validity and all-invalid responses
// ============================================================

describe('fetchGreenhouseJobs structured issues', () => {
  it('returns both valid and invalid records with issues in mixed response', async () => {
    const mixedBody = JSON.stringify({
      jobs: [
        {
          id: 8001,
          title: 'Valid Job',
          location: { name: 'Long Beach, CA' },
          absolute_url: 'https://boards.greenhouse.io/test/jobs/8001',
          content: '<p>Valid description.</p>',
          departments: [{ name: 'Research & Development' }],
          offices: [{ name: 'Long Beach' }],
        },
        {
          id: 8002,
          title: 'No URL Job',
          absolute_url: null, // will be skipped
          content: '<p>desc</p>',
        },
      ],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'testboard',
      fetchFn: mockFetch(mixedBody),
    });
    expect(result.ok).toBe(true); // partial success
    expect(result.candidates.length).toBe(1); // one valid
    expect(result.recordsSeen).toBe(2);
    expect(result.recordsNormalized).toBe(1);
    expect(result.recordsSkipped).toBe(1);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('returns ok: false when all records fail normalization', async () => {
    const allInvalidBody = JSON.stringify({
      jobs: [
        { id: 7001, title: 'No URL 1', absolute_url: null },
        { id: 7002, title: 'No URL 2', absolute_url: 'javascript:x' },
        { id: 7003, title: 'No URL 3', absolute_url: 'ftp://not-http' },
      ],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'testboard',
      fetchFn: mockFetch(allInvalidBody),
    });
    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('schema');
    expect(result.error?.code).toBe('invalid_shape');
    expect(result.candidates).toHaveLength(0);
    expect(result.recordsSkipped).toBe(3);
  });

  it('issues include safe job identifiers', async () => {
    const body = JSON.stringify({
      jobs: [{ id: 6001, title: 'No URL', absolute_url: null }],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'testboard',
      fetchFn: mockFetch(body),
    });
    expect(result.issues.length).toBeGreaterThan(0);
    // safeId should contain the job ID in some form
    const issue = result.issues[0];
    expect(issue.safeId).not.toBeNull();
    expect(issue.message).toBeTruthy();
    // Issues must not contain raw job description content
    expect(issue.message).not.toContain('<p>');
  });

  it('result includes recordsSeen, recordsNormalized, recordsSkipped', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });
    expect(result.ok).toBe(true);
    expect(typeof result.recordsSeen).toBe('number');
    expect(typeof result.recordsNormalized).toBe('number');
    expect(typeof result.recordsSkipped).toBe('number');
    expect(result.recordsSeen).toBeGreaterThan(0);
    expect(result.recordsNormalized).toBe(result.candidates.length);
    expect(result.recordsSeen).toBe(result.recordsNormalized + result.recordsSkipped);
  });
});

// ============================================================
// ERROR TYPES — errorClass vs code alignment
// ============================================================

describe('ConnectorError errorClass and code alignment', () => {
  it('auth error has errorClass auth', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Unauthorized', 401),
    });
    expect(result.error?.errorClass).toBe('auth');
    expect(result.error?.code).toBe('auth');
  });

  it('not_found error has code not_found and errorClass unexpected', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Not Found', 404),
    });
    expect(result.error?.code).toBe('not_found');
    expect(result.error?.errorClass).toBe('unexpected');
  });

  it('server_error has code server_error and errorClass unexpected', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Error', 500),
    });
    expect(result.error?.code).toBe('server_error');
    expect(result.error?.errorClass).toBe('unexpected');
  });

  it('rate_limit has errorClass rate_limit', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('Too Many Requests', 429),
    });
    expect(result.error?.errorClass).toBe('rate_limit');
    expect(result.error?.httpStatus).toBe(429);
  });

  it('invalid_json error has code invalid_json and errorClass schema', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('not-valid-json {{{'),
    });
    expect(result.error?.code).toBe('invalid_json');
    expect(result.error?.errorClass).toBe('schema');
  });

  it('invalid_shape error has code invalid_shape and errorClass schema', async () => {
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch('{"data": []}'), // missing jobs array
    });
    expect(result.error?.code).toBe('invalid_shape');
    expect(result.error?.errorClass).toBe('schema');
  });
});

// ============================================================
// GREENHOUSE FIELD MAPPING — sourceUpdatedAt, sourceMetadata
// ============================================================

describe('normalizeGreenhouseJob field mapping', () => {
  const BOARD_TOKEN = 'labgenomicsinc';
  const FETCHED_AT = '2026-07-11T00:00:00.000Z';

  it('maps updated_at to sourceUpdatedAt', () => {
    const job = {
      id: 1001001,
      title: 'Test Job',
      updated_at: '2026-06-15T14:00:00-07:00',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/1001001',
      location: { name: 'Long Beach, CA' },
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceUpdatedAt).toBe('2026-06-15T14:00:00-07:00');
  });

  it('maps metadata array to sourceMetadata', () => {
    const job = {
      id: 1001002,
      title: 'Test Job 2',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/1001002',
      metadata: [{ id: 1, name: 'Type', value: 'Internship' }],
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceMetadata).not.toBeNull();
    expect(Array.isArray(posting.sourceMetadata)).toBe(true);
  });

  it('sourceUpdatedAt is null when updated_at absent', () => {
    const job = {
      id: 1001003,
      title: 'Test Job 3',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/1001003',
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceUpdatedAt).toBeNull();
  });

  it('sourceMetadata is null when metadata absent', () => {
    const job = {
      id: 1001004,
      title: 'Test Job 4',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/1001004',
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceMetadata).toBeNull();
  });
});

// ============================================================
// BOARD TOKEN NORMALIZATION — trim and lowercase
// ============================================================

describe('validateBoardToken normalization', () => {
  it('accepts token with surrounding whitespace (trims it)', () => {
    const result = validateBoardToken('  mycompany  ');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.normalized).toBe('mycompany');
  });

  it('accepts uppercase token and returns lowercased normalized form', () => {
    const result = validateBoardToken('MyCompany');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.normalized).toBe('mycompany');
  });

  it('accepts mixed-case token with whitespace and returns normalized form', () => {
    const result = validateBoardToken('  LabGenomicsInc  ');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.normalized).toBe('labgenomicsinc');
  });

  it('uses normalized token in identityKey and URL when uppercase token is provided', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'LabGenomicsInc',
      fetchFn: mockFetch(body),
    });
    expect(result.ok).toBe(true);
    // URL must use the lowercased token
    expect(result.requestUrl).toContain('labgenomicsinc');
    expect(result.requestUrl).not.toContain('LabGenomicsInc');
    // All candidate identityKeys must use the lowercased token
    for (const c of result.candidates) {
      expect(c.identityKey).toContain('labgenomicsinc');
      expect(c.identityKey).not.toContain('LabGenomicsInc');
    }
  });

  it('uses normalized token when board token has surrounding whitespace', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: '  labgenomicsinc  ',
      fetchFn: mockFetch(body),
    });
    expect(result.ok).toBe(true);
    expect(result.requestUrl).toContain('labgenomicsinc');
    expect(result.requestUrl).not.toContain('  ');
  });
});

// ============================================================
// RESPONSE URL VALIDATION — HTTPS + correct hostname
// ============================================================

describe('fetchGreenhouseJobs response.url validation', () => {
  it('rejects a response whose final URL is a foreign host (HTTPS)', async () => {
    // Simulate a fetch that returns a 200 with a foreign response.url (e.g., after a
    // server-side redirect followed by a re-fetch — or a misconfigured proxy).
    const foreignFinalUrlFetch: typeof fetch = (_url, _init) => {
      const response = new Response(loadFixture('greenhouse-normal.json'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      // Patch response.url to simulate a foreign host
      Object.defineProperty(response, 'url', { value: 'https://evil.example.com/jobs' });
      return Promise.resolve(response);
    };
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: foreignFinalUrlFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('unexpected');
    expect(result.error?.code).toBe('redirect_rejected');
  });

  it('rejects a response whose final URL uses HTTP (not HTTPS)', async () => {
    const httpFinalUrlFetch: typeof fetch = (_url, _init) => {
      const response = new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      Object.defineProperty(response, 'url', { value: 'http://boards-api.greenhouse.io/v1/boards/test/jobs' });
      return Promise.resolve(response);
    };
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: httpFinalUrlFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.errorClass).toBe('unexpected');
    expect(result.error?.code).toBe('redirect_rejected');
  });

  it('accepts a response whose final URL is the correct Greenhouse host', async () => {
    const correctFinalUrlFetch: typeof fetch = (_url, _init) => {
      const response = new Response(loadFixture('greenhouse-normal.json'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      Object.defineProperty(response, 'url', {
        value: 'https://boards-api.greenhouse.io/v1/boards/labgenomicsinc/jobs?content=true',
      });
      return Promise.resolve(response);
    };
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: correctFinalUrlFetch,
    });
    expect(result.ok).toBe(true);
  });
});

// ============================================================
// TIMEOUT PRESERVATION — non-2xx hanging body
// ============================================================

describe('fetchGreenhouseJobs non-2xx body timeout', () => {
  it('returns errorClass timeout when 500 body stream hangs', async () => {
    // Return a 500 whose body never resolves — simulates a server that sends headers
    // but stalls the body indefinitely.
    const hangingBody500Fetch: typeof fetch = (_url, init) => {
      const { signal } = init as RequestInit;
      const stream = new ReadableStream({
        start(controller) {
          if (signal) {
            signal.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          }
          // Never enqueue or close
        },
      });
      const response = new Response(stream, {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      });
      return Promise.resolve(response);
    };
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: hangingBody500Fetch,
      timeoutMs: 200,
    });
    expect(result.ok).toBe(false);
    // Must be timeout — NOT server_error or not_found or rate_limit
    expect(result.error?.errorClass).toBe('timeout');
  });
});

// ============================================================
// PARTIAL RESPONSE FLAG — partial_response in candidates
// ============================================================

describe('fetchGreenhouseJobs partial_response flag', () => {
  it('adds partial_response to candidates when some records are skipped', async () => {
    const mixedBody = JSON.stringify({
      jobs: [
        {
          id: 5001,
          title: 'Valid Job',
          location: { name: 'Long Beach, CA' },
          absolute_url: 'https://boards.greenhouse.io/test/jobs/5001',
          content: '<p>Valid description for a biotech intern.</p>',
        },
        {
          id: 5002,
          title: 'No URL Job',
          absolute_url: null,
          content: '<p>desc</p>',
        },
      ],
    });
    const result = await fetchGreenhouseJobs({
      boardToken: 'testboard',
      fetchFn: mockFetch(mixedBody),
    });
    expect(result.ok).toBe(true);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0].uncertaintyFlags).toContain('partial_response');
  });

  it('does NOT add partial_response when all records normalize successfully', async () => {
    const body = loadFixture('greenhouse-normal.json');
    const result = await fetchGreenhouseJobs({
      boardToken: 'labgenomicsinc',
      fetchFn: mockFetch(body),
    });
    expect(result.ok).toBe(true);
    for (const c of result.candidates) {
      expect(c.uncertaintyFlags).not.toContain('partial_response');
    }
  });
});

// ============================================================
// SOURCE UPDATED AT VALIDATION
// ============================================================

describe('normalizeGreenhouseJob sourceUpdatedAt validation', () => {
  const BOARD_TOKEN = 'labgenomicsinc';
  const FETCHED_AT = '2026-07-11T00:00:00.000Z';

  it('passes through a valid ISO timestamp unchanged', () => {
    const job = {
      id: 9901,
      title: 'Test',
      updated_at: '2026-06-15T14:00:00-07:00',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/9901',
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceUpdatedAt).toBe('2026-06-15T14:00:00-07:00');
    expect(posting.uncertaintyFlags).not.toContain('source_updated_at_invalid');
  });

  it('sets sourceUpdatedAt to null for a non-timestamp string and adds source_updated_at_invalid flag', () => {
    const job = {
      id: 9902,
      title: 'Test',
      updated_at: 'not-a-real-timestamp',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/9902',
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceUpdatedAt).toBeNull();
    expect(posting.uncertaintyFlags).toContain('source_updated_at_invalid');
  });

  it('sets sourceUpdatedAt to null when updated_at is absent', () => {
    const job = {
      id: 9903,
      title: 'Test',
      absolute_url: 'https://boards.greenhouse.io/co/jobs/9903',
    };
    const posting = normalizeGreenhouseJob(job as Parameters<typeof normalizeGreenhouseJob>[0], BOARD_TOKEN, FETCHED_AT);
    expect(posting.sourceUpdatedAt).toBeNull();
    expect(posting.uncertaintyFlags).not.toContain('source_updated_at_invalid');
  });
});
