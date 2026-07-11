/**
 * Greenhouse Job Board connector (Phase 2A).
 *
 * Uses only the documented public Greenhouse Job Board GET endpoint:
 *   GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 *
 * Security boundaries:
 * - No authentication or application-submission endpoints.
 * - Board token is validated before the URL is constructed.
 * - No arbitrary fetch URLs accepted; URL is always built internally.
 * - Bounded response-size limit (default 10 MiB).
 * - Abort timeout (default 30 s).
 * - Raw response body is never logged.
 * - No N+1 individual job-detail fetches in this phase.
 * - No Supabase client; no database writes.
 * - No secrets or credentials required.
 *
 * Connector version: "1.0.0"
 */

import type {
  ConnectorError,
  ConnectorFetchResult,
  GreenhouseConnectorConfig,
  NormalizedSourcePosting,
  UncertaintyFlag,
} from '../types';
import {
  canonicalizeUrl,
  classifyDeadlineKind,
  classifyOpportunity,
  classifyRemoteType,
  htmlToText,
  inferFocusArea,
  normalizeDepartment,
  normalizeEmployerName,
  normalizeJobTitle,
  normalizeLocation,
  parseIsoDate,
} from '../normalize';
import {
  makeGreenhouseIdentityKey,
  makeGreenhouseMaterialHash,
  sha256Hex,
  stableSerialize,
} from '../hash';
import { scoreIngestionCandidate } from '../score';
import { SCORE_VERSION } from '../score';

/** Semantic version of this connector's normalization logic. */
export const CONNECTOR_VERSION = '1.0.0';

/** Default fetch timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Default maximum response size in bytes (10 MiB). */
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/** Greenhouse boards API base URL. Never accept an externally supplied URL. */
const GREENHOUSE_BASE_URL = 'https://boards-api.greenhouse.io';

// ============================================================
// BOARD TOKEN VALIDATION
// ============================================================

/**
 * Validate a Greenhouse board token.
 *
 * Greenhouse board tokens consist of lowercase letters, digits, and hyphens.
 * They are typically 2–128 characters long.
 * We allow underscores as some boards use them; we reject anything else.
 *
 * This is a strict allowlist to prevent SSRF via token injection.
 */
export function validateBoardToken(token: string): { valid: true } | { valid: false; reason: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Board token must be a non-empty string.' };
  }
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'Board token must not be blank.' };
  }
  if (trimmed.length > 128) {
    return { valid: false, reason: 'Board token exceeds maximum length of 128 characters.' };
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
    return {
      valid: false,
      reason: 'Board token must contain only letters, digits, hyphens, and underscores, and must start with a letter or digit.',
    };
  }
  return { valid: true };
}

/**
 * Construct the Greenhouse jobs API URL for a validated board token.
 * Never accepts a raw external URL.
 */
export function buildGreenhouseUrl(boardToken: string): string {
  return `${GREENHOUSE_BASE_URL}/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`;
}

// ============================================================
// RAW API RESPONSE TYPES
// ============================================================

/** Shape of a single job from the Greenhouse boards API. */
interface GreenhouseJob {
  id: number;
  internal_job_id?: number | null;
  title?: string | null;
  updated_at?: string | null;
  requisition_id?: string | null;
  location?: { name?: string | null } | null;
  absolute_url?: string | null;
  content?: string | null;
  departments?: Array<{ id?: number; name?: string | null }> | null;
  offices?: Array<{ id?: number; name?: string | null }> | null;
  metadata?: unknown[] | null;
  language?: string | null;
  first_published?: string | null;
  application_deadline?: string | null;
}

interface GreenhouseApiResponse {
  jobs: GreenhouseJob[];
  meta?: { total?: number };
}

// ============================================================
// TYPE GUARD
// ============================================================

function isGreenhouseApiResponse(value: unknown): value is GreenhouseApiResponse {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.jobs)) return false;
  return true;
}

function isGreenhouseJob(value: unknown): value is GreenhouseJob {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.id === 'number';
}

// ============================================================
// JOB NORMALIZATION
// ============================================================

/**
 * Normalize a single Greenhouse job into a NormalizedSourcePosting.
 *
 * @param job        Raw job object from the API.
 * @param boardToken Validated board token used to build the identity key.
 * @param fetchedAt  ISO timestamp of the fetch operation.
 */
export function normalizeGreenhouseJob(
  job: GreenhouseJob,
  boardToken: string,
  fetchedAt: string,
): NormalizedSourcePosting {
  const flags: UncertaintyFlag[] = [];

  // --- External IDs ---
  const externalPostingId = String(job.id);
  const internalJobId = job.internal_job_id != null ? String(job.internal_job_id) : null;
  const requisitionId = job.requisition_id ?? null;

  // --- Identity ---
  const identityKey = makeGreenhouseIdentityKey(boardToken, externalPostingId);

  // --- Employer name ---
  // Greenhouse job boards do not include employer name in job objects;
  // it is available only at the board level. We leave it null here — the
  // calling code that knows the board name should enrich this field.
  const employerNameRaw: string | null = null;
  const employerNameNormalized: string | null = null;
  if (!employerNameRaw) flags.push('employer_name_missing');

  // --- Title ---
  const titleRaw = job.title ?? null;
  const titleNormalized = normalizeJobTitle(titleRaw);
  if (!titleRaw) flags.push('description_missing'); // treat missing title as missing content

  // --- Location ---
  const locationRaw = job.location?.name ?? null;
  const locationNormalized = normalizeLocation(locationRaw);
  if (!locationRaw) flags.push('location_missing');

  // --- URL ---
  const rawUrl = job.absolute_url ?? null;
  const canonicalUrl = (rawUrl ? canonicalizeUrl(rawUrl) : null) ?? '';
  // If we can't get a canonical URL, fall back to a constructed one
  const effectiveUrl = canonicalUrl || `${GREENHOUSE_BASE_URL}/jobs/${externalPostingId}`;

  // --- Content ---
  const descriptionText = htmlToText(job.content);
  if (!job.content) flags.push('description_missing');

  // --- Departments ---
  const departmentsRaw: string[] = (job.departments ?? [])
    .map((d) => d.name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  const departments = departmentsRaw.map((d) => d.trim()).sort();
  const department = departments.length > 0 ? (normalizeDepartment(departments[0]) ?? departments[0]) : null;

  // --- Offices ---
  const offices = (job.offices ?? [])
    .map((o) => o.name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim())
    .sort();

  // --- Dates ---
  const postedAt = parseIsoDate(job.first_published);
  const rawDeadline = job.application_deadline ?? null;
  const closesAt = parseIsoDate(rawDeadline);
  if (rawDeadline && !closesAt) flags.push('deadline_invalid');
  if (!rawDeadline) flags.push('deadline_missing');
  const deadlineKind = classifyDeadlineKind(rawDeadline, closesAt);

  // --- Language ---
  const language = job.language ?? null;

  // --- Classification ---
  const { classification, inferred: classificationInferred } = classifyOpportunity(
    titleRaw,
    null, // employment type not available in list endpoint
    descriptionText,
  );
  if (classificationInferred) flags.push('classification_inferred');

  // --- Remote type ---
  const { remoteType, flags: remoteFlags } = classifyRemoteType(
    titleRaw,
    locationRaw,
    descriptionText,
  );
  flags.push(...remoteFlags);

  // --- Employment type ---
  // Not available in the Greenhouse jobs-list endpoint.
  const employmentType: string | null = null;
  flags.push('employment_type_missing');

  // --- Focus area ---
  const focusArea = inferFocusArea(titleRaw, descriptionText);

  // --- Score ---
  const scoreBreakdown = scoreIngestionCandidate({
    titleRaw,
    titleNormalized,
    locationNormalized,
    department,
    departments,
    classification,
    remoteType,
    canonicalUrl: effectiveUrl || null,
    descriptionText,
    closesAt,
    uncertaintyFlags: flags,
  });

  // --- Material hash ---
  const materialHash = makeGreenhouseMaterialHash({
    titleRaw,
    locationRaw,
    canonicalUrl: effectiveUrl,
    departments,
    offices,
    closesAt,
    deadlineKind,
  });

  return {
    identityKey,
    materialHash,
    connectorVersion: CONNECTOR_VERSION,
    sourceKind: 'greenhouse',
    externalPostingId,
    internalJobId,
    requisitionId,
    employerNameRaw,
    employerNameNormalized,
    titleRaw,
    titleNormalized,
    locationRaw,
    locationNormalized,
    canonicalUrl: effectiveUrl,
    remoteType,
    employmentType,
    classification,
    department,
    departments,
    offices,
    focusArea,
    postedAt,
    closesAt,
    deadlineKind,
    descriptionText,
    language,
    relevanceScore: scoreBreakdown.total,
    relevanceScoreVersion: SCORE_VERSION,
    scoreBreakdown,
    uncertaintyFlags: [...new Set(flags)], // deduplicate flags
    fetchedAt,
  };
}

// ============================================================
// CONNECTOR FETCH
// ============================================================

/**
 * Fetch all jobs from a Greenhouse board and return normalized candidates.
 *
 * Security:
 * - Board token is validated before any network request is made.
 * - URL is always constructed internally from the validated token.
 * - Response size is bounded (DEFAULT_MAX_RESPONSE_BYTES).
 * - Request aborts after DEFAULT_TIMEOUT_MS.
 * - Raw response body is never logged.
 *
 * @param config  Connector configuration including board token and optional overrides.
 * @returns       ConnectorFetchResult with all normalized postings or a typed error.
 */
export async function fetchGreenhouseJobs(
  config: GreenhouseConnectorConfig,
): Promise<ConnectorFetchResult> {
  const fetchedAt = new Date().toISOString();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const fetchFn = config.fetchFn ?? fetch;

  // Validate token before making any request
  const tokenCheck = validateBoardToken(config.boardToken);
  if (!tokenCheck.valid) {
    return {
      ok: false,
      candidates: [],
      rawResponseText: null,
      requestUrl: '',
      finalUrl: null,
      httpStatus: null,
      contentType: null,
      etag: null,
      lastModified: null,
      error: {
        kind: 'schema',
        message: `Invalid board token: ${tokenCheck.reason}`,
      },
      fetchedAt,
    };
  }

  const requestUrl = buildGreenhouseUrl(config.boardToken);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(requestUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'csulb-biotech-career-hub-ingestion/1.0 (https://github.com/austinesparza/csulb-biotech-career-hub)',
      },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.name === 'TimeoutError');
    return {
      ok: false,
      candidates: [],
      rawResponseText: null,
      requestUrl,
      finalUrl: null,
      httpStatus: null,
      contentType: null,
      etag: null,
      lastModified: null,
      error: {
        kind: isAbort ? 'timeout' : 'network',
        message: isAbort
          ? `Request timed out after ${timeoutMs}ms.`
          : `Network error: ${err instanceof Error ? err.message : String(err)}`,
      },
      fetchedAt,
    };
  } finally {
    clearTimeout(timer);
  }

  const httpStatus = response.status;
  const contentType = response.headers.get('content-type');
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  // response.url is the final URL after redirects (where available)
  const finalUrl = response.url || null;

  // Handle non-2xx responses
  if (!response.ok) {
    // Drain body to avoid resource leak (but do not log it)
    try { await response.text(); } catch { /* ignore */ }
    const kind = toErrorKind(httpStatus);
    return {
      ok: false,
      candidates: [],
      rawResponseText: null,
      requestUrl,
      finalUrl,
      httpStatus,
      contentType,
      etag,
      lastModified,
      error: {
        kind,
        message: `HTTP ${httpStatus} from Greenhouse boards API.`,
        httpStatus,
      },
      fetchedAt,
    };
  }

  // Read body with size limit
  let rawResponseText: string;
  try {
    rawResponseText = await readBoundedText(response, maxBytes);
  } catch (err: unknown) {
    const isOversize = err instanceof Error && err.message.includes('exceeds');
    return {
      ok: false,
      candidates: [],
      rawResponseText: null,
      requestUrl,
      finalUrl,
      httpStatus,
      contentType,
      etag,
      lastModified,
      error: {
        kind: isOversize ? 'oversized' : 'network',
        message: isOversize
          ? `Response exceeds ${maxBytes} byte limit.`
          : `Error reading response body: ${err instanceof Error ? err.message : String(err)}`,
        httpStatus,
      },
      fetchedAt,
    };
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponseText);
  } catch {
    return {
      ok: false,
      candidates: [],
      rawResponseText,
      requestUrl,
      finalUrl,
      httpStatus,
      contentType,
      etag,
      lastModified,
      error: {
        kind: 'schema',
        message: 'Response body is not valid JSON.',
        httpStatus,
      },
      fetchedAt,
    };
  }

  // Validate response shape
  if (!isGreenhouseApiResponse(parsed)) {
    return {
      ok: false,
      candidates: [],
      rawResponseText,
      requestUrl,
      finalUrl,
      httpStatus,
      contentType,
      etag,
      lastModified,
      error: {
        kind: 'schema',
        message: 'Response does not match expected Greenhouse API shape (missing "jobs" array).',
        httpStatus,
      },
      fetchedAt,
    };
  }

  // Normalize each job
  const candidates: NormalizedSourcePosting[] = [];
  for (const job of parsed.jobs) {
    if (!isGreenhouseJob(job)) continue; // skip malformed job objects
    try {
      candidates.push(normalizeGreenhouseJob(job, config.boardToken, fetchedAt));
    } catch {
      // Skip individual job normalization errors; partial results are returned.
      // Errors are not logged (they may contain PII from response fields).
    }
  }

  return {
    ok: true,
    candidates,
    rawResponseText,
    requestUrl,
    finalUrl,
    httpStatus,
    contentType,
    etag,
    lastModified,
    error: null,
    fetchedAt,
  };
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Map an HTTP status code to a typed error kind.
 * Used for error classification in connector results.
 */
function toErrorKind(status: number): ConnectorError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server_error';
  return 'unexpected';
}

/**
 * Read a Response body as text, aborting if the content exceeds maxBytes.
 * Throws an Error with "exceeds" in the message if the limit is reached.
 */
async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Fallback for environments where body is not a ReadableStream
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new Error(`Response body exceeds ${maxBytes} byte limit.`);
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      reader.cancel().catch(() => { /* ignore cancel errors */ });
      throw new Error(`Response body exceeds ${maxBytes} byte limit.`);
    }
    chunks.push(value);
  }

  return chunks.map((c) => decoder.decode(c, { stream: true })).join('') +
         decoder.decode(undefined, { stream: false });
}

// Re-export for external use in tests and later phases
export { sha256Hex, stableSerialize };
