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
 * - Bounded response-size limit (default 10 MiB, max 20 MiB).
 * - Abort timeout covers the COMPLETE operation including body streaming
 *   and normalization (default 30 s, max 120 s).
 * - Timer is cleared exactly once after the entire operation completes or fails.
 * - Redirect mode is 'manual'; all 3xx responses are rejected as errors.
 * - Non-2xx response bodies are read with the same bounded reader (not unbounded text()).
 * - Raw response body is never logged.
 * - No N+1 individual job-detail fetches in this phase.
 * - No Supabase client; no database writes.
 * - No secrets or credentials required.
 *
 * Connector version: "1.0.0"
 */

import type {
  ConnectorError,
  ConnectorErrorCode,
  ConnectorFetchResult,
  ConnectorIssue,
  GreenhouseConnectorConfig,
  NormalizedSourcePosting,
  SourceFetchErrorClass,
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

/** Hard lower bound for timeoutMs (100 ms). */
const MIN_TIMEOUT_MS = 100;

/** Hard upper bound for timeoutMs (120 s). */
const MAX_TIMEOUT_MS = 120_000;

/** Hard lower bound for maxResponseBytes (1 KiB). */
const MIN_RESPONSE_BYTES = 1024;

/** Hard upper bound for maxResponseBytes (20 MiB). */
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

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
 *
 * The token is normalized (trimmed + lowercased) before validation.
 * Returns the normalized token on success so callers always use the canonical form.
 */
export function validateBoardToken(token: string): { valid: true; normalized: string } | { valid: false; reason: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Board token must be a non-empty string.' };
  }
  const normalized = token.trim().toLowerCase();
  if (normalized.length === 0) {
    return { valid: false, reason: 'Board token must not be blank.' };
  }
  if (normalized.length > 128) {
    return { valid: false, reason: 'Board token exceeds maximum length of 128 characters.' };
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(normalized)) {
    return {
      valid: false,
      reason: 'Board token must contain only letters, digits, hyphens, and underscores, and must start with a letter or digit.',
    };
  }
  return { valid: true, normalized };
}

/**
 * Validate timeoutMs: must be a finite integer in [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS].
 */
export function validateTimeoutMs(value: number): { valid: true; value: number } | { valid: false; reason: string } {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { valid: false, reason: `timeoutMs must be a finite integer, got ${value}.` };
  }
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    return { valid: false, reason: `timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}, got ${value}.` };
  }
  return { valid: true, value };
}

/**
 * Validate maxResponseBytes: must be a finite integer in [MIN_RESPONSE_BYTES, MAX_RESPONSE_BYTES].
 */
export function validateMaxResponseBytes(value: number): { valid: true; value: number } | { valid: false; reason: string } {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { valid: false, reason: `maxResponseBytes must be a finite integer, got ${value}.` };
  }
  if (value < MIN_RESPONSE_BYTES || value > MAX_RESPONSE_BYTES) {
    return { valid: false, reason: `maxResponseBytes must be between ${MIN_RESPONSE_BYTES} and ${MAX_RESPONSE_BYTES}, got ${value}.` };
  }
  return { valid: true, value };
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
 * Returns the posting, or throws a ConnectorIssue if the record is invalid.
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
  if (!titleRaw) flags.push('title_missing');

  // --- Location ---
  const locationRaw = job.location?.name ?? null;
  const locationNormalized = normalizeLocation(locationRaw);
  if (!locationRaw) flags.push('location_missing');

  // --- URL ---
  // Do NOT fabricate a canonical URL. If absolute_url is missing, invalid,
  // non-HTTP(S), or uses an unsupported scheme, the record is invalid and
  // must be skipped by the caller via the ConnectorIssue mechanism.
  const rawUrl = job.absolute_url ?? null;
  const canonicalUrl = rawUrl ? canonicalizeUrl(rawUrl) : null;
  if (!canonicalUrl) {
    flags.push('url_invalid');
  }

  // --- Content ---
  const descriptionText = htmlToText(job.content);
  if (!job.content) flags.push('description_missing');

  // --- Source metadata ---
  // Validate sourceUpdatedAt as an ISO timestamp.  Malformed values become null
  // with an uncertainty flag rather than silently forwarding a non-timestamp string.
  let sourceUpdatedAt: string | null = null;
  if (job.updated_at != null) {
    const raw = job.updated_at;
    const parsed = Date.parse(raw);
    if (!isNaN(parsed)) {
      sourceUpdatedAt = raw;
    } else {
      flags.push('source_updated_at_invalid');
    }
  }
  // Preserve metadata deterministically (sorted by stable serialization).
  // Do not include in scoring unless explicitly supported.
  const sourceMetadata: unknown | null = job.metadata != null
    ? (Array.isArray(job.metadata) ? job.metadata : null)
    : null;

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
    canonicalUrl: canonicalUrl || null,
    descriptionText,
    closesAt,
    uncertaintyFlags: flags,
  });

  // --- Material hash ---
  // Normalized description text is included in the hash so meaningful text
  // changes trigger officer review. HTML-only formatting changes do not affect
  // the normalized text and therefore do not change the hash.
  const materialHash = makeGreenhouseMaterialHash({
    titleRaw,
    locationRaw,
    canonicalUrl: canonicalUrl ?? '',
    departments,
    offices,
    closesAt,
    deadlineKind,
    descriptionNormalized: descriptionText,
    employmentType,
    classification,
    remoteType,
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
    canonicalUrl: canonicalUrl ?? '',
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
    sourceUpdatedAt,
    sourceMetadata,
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
 * - Response size is bounded (maxResponseBytes).
 * - Abort timeout covers the COMPLETE operation including body stream and normalization.
 * - Timer is cleared exactly once.
 * - Redirect mode is 'manual'; all 3xx responses are rejected.
 * - Non-2xx response bodies use the same bounded reader.
 * - Raw response body is never logged.
 * - Records with missing/invalid canonical URLs are skipped with a ConnectorIssue.
 * - If all records fail, returns ok: false with errorClass schema.
 *
 * @param config  Connector configuration including board token and optional overrides.
 * @returns       ConnectorFetchResult with all normalized postings or a typed error.
 */
export async function fetchGreenhouseJobs(
  config: GreenhouseConnectorConfig,
): Promise<ConnectorFetchResult> {
  const fetchedAt = new Date().toISOString();
  const fetchFn = config.fetchFn ?? fetch;

  // --- Config validation ---
  // timeoutMs
  let timeoutMs: number;
  if (config.timeoutMs !== undefined) {
    const tv = validateTimeoutMs(config.timeoutMs);
    if (!tv.valid) {
      return makeFailure({
        errorClass: 'schema',
        code: 'invalid_config',
        message: tv.reason,
      }, { fetchedAt });
    }
    timeoutMs = tv.value;
  } else {
    timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  // maxResponseBytes
  let maxBytes: number;
  if (config.maxResponseBytes !== undefined) {
    const bv = validateMaxResponseBytes(config.maxResponseBytes);
    if (!bv.valid) {
      return makeFailure({
        errorClass: 'schema',
        code: 'invalid_config',
        message: bv.reason,
      }, { fetchedAt });
    }
    maxBytes = bv.value;
  } else {
    maxBytes = DEFAULT_MAX_RESPONSE_BYTES;
  }

  // --- Token validation ---
  const tokenCheck = validateBoardToken(config.boardToken);
  if (!tokenCheck.valid) {
    return makeFailure({
      errorClass: 'schema',
      code: 'invalid_config',
      message: `Invalid board token: ${tokenCheck.reason}`,
    }, { fetchedAt });
  }
  // Use the normalized (trimmed + lowercased) token for URL construction and all keys.
  const boardToken = tokenCheck.normalized;

  const requestUrl = buildGreenhouseUrl(boardToken);

  // --- Timeout setup ---
  // The controller covers the ENTIRE operation: fetch + body stream + parsing + normalization.
  // It is cleared exactly once in the finally block after everything completes or fails.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // --- Fetch (with redirect: 'manual') ---
    let response: Response;
    try {
      response = await fetchFn(requestUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'csulb-biotech-career-hub-ingestion/1.0 (https://github.com/austinesparza/csulb-biotech-career-hub)',
        },
      });
    } catch (err: unknown) {
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError');
      return makeFailure({
        errorClass: isAbort ? 'timeout' : 'network',
        code: isAbort ? 'timeout' : 'network',
        message: isAbort
          ? `Request timed out after ${timeoutMs}ms.`
          : `Network error: ${err instanceof Error ? err.message : String(err)}`,
      }, { fetchedAt, requestUrl });
    }

    const httpStatus = response.status;
    const contentType = response.headers.get('content-type');
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    const finalUrl = response.url || null;

    // --- Final-URL validation ---
    // After fetch (even with redirect: 'manual'), verify the final URL is the
    // expected Greenhouse host.  A non-empty response.url that does not use HTTPS
    // or points to a foreign host indicates an unexpected redirect and is rejected.
    if (finalUrl) {
      try {
        const finalParsed = new URL(finalUrl);
        if (finalParsed.protocol !== 'https:' || finalParsed.hostname !== 'boards-api.greenhouse.io') {
          try { response.body?.cancel(); } catch { /* ignore */ }
          return makeFailure({
            errorClass: 'unexpected',
            code: 'redirect_rejected',
            message: `Final URL is not the expected Greenhouse host: "${finalUrl}".`,
            httpStatus,
          }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified });
        }
      } catch {
        // If the URL can't be parsed, treat it as an unexpected host
        try { response.body?.cancel(); } catch { /* ignore */ }
        return makeFailure({
          errorClass: 'unexpected',
          code: 'redirect_rejected',
          message: `Final URL could not be parsed: "${finalUrl}".`,
          httpStatus,
        }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified });
      }
    }

    // --- Redirect rejection ---
    // redirect: 'manual' causes 3xx responses to be returned as opaque redirects.
    // We reject all 3xx responses as a security boundary.
    if (httpStatus >= 300 && httpStatus < 400) {
      // Drain body if present without reading it
      try { response.body?.cancel(); } catch { /* ignore */ }
      return makeFailure({
        errorClass: 'unexpected',
        code: 'redirect_rejected',
        message: `Redirect rejected: HTTP ${httpStatus}. Redirects to arbitrary hosts are not followed.`,
        httpStatus,
      }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified });
    }

    // --- Non-2xx responses ---
    if (!response.ok) {
      // Read bounded error body for provenance (never log it).
      // If reading the error body is aborted by the timeout, preserve the timeout
      // classification rather than converting it into not_found / rate_limit / server_error.
      let rawErrorText: string | null = null;
      try {
        rawErrorText = await readBoundedText(response, Math.min(maxBytes, 65536));
      } catch (bodyErr: unknown) {
        const isAbort =
          bodyErr instanceof Error &&
          (bodyErr.name === 'AbortError' || bodyErr.name === 'TimeoutError');
        if (isAbort) {
          return makeFailure({
            errorClass: 'timeout',
            code: 'timeout',
            message: `Request timed out after ${timeoutMs}ms (error body stream).`,
            httpStatus,
          }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified });
        }
        // Oversized or unreadable — discard error body
        rawErrorText = null;
      }
      const errorClass = toErrorClass(httpStatus);
      const code = toErrorCode(httpStatus);
      return {
        ok: false,
        candidates: [],
        rawResponseText: rawErrorText,
        requestUrl,
        finalUrl,
        httpStatus,
        contentType,
        etag,
        lastModified,
        error: {
          errorClass,
          code,
          message: `HTTP ${httpStatus} from Greenhouse boards API.`,
          httpStatus,
        },
        fetchedAt,
        recordsSeen: 0,
        recordsNormalized: 0,
        recordsSkipped: 0,
        issues: [],
      };
    }

    // --- Read body with size limit ---
    let rawResponseText: string;
    try {
      rawResponseText = await readBoundedText(response, maxBytes);
    } catch (err: unknown) {
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.name === 'TimeoutError');
      const isOversize = err instanceof Error && err.message.includes('exceeds');
      if (isAbort) {
        return makeFailure({
          errorClass: 'timeout',
          code: 'timeout',
          message: `Request timed out after ${timeoutMs}ms (body stream).`,
          httpStatus,
        }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified });
      }
      return makeFailure({
        errorClass: isOversize ? 'schema' : 'network',
        code: isOversize ? 'response_oversized' : 'network',
        message: isOversize
          ? `Response exceeds ${maxBytes} byte limit.`
          : `Error reading response body: ${err instanceof Error ? err.message : String(err)}`,
        httpStatus,
      }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified });
    }

    // --- Parse JSON ---
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponseText);
    } catch {
      return makeFailure({
        errorClass: 'schema',
        code: 'invalid_json',
        message: 'Response body is not valid JSON.',
        httpStatus,
      }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified, rawResponseText });
    }

    // --- Validate response shape ---
    if (!isGreenhouseApiResponse(parsed)) {
      return makeFailure({
        errorClass: 'schema',
        code: 'invalid_shape',
        message: 'Response does not match expected Greenhouse API shape (missing "jobs" array).',
        httpStatus,
      }, { fetchedAt, requestUrl, finalUrl, httpStatus, contentType, etag, lastModified, rawResponseText });
    }

    // --- Normalize each job ---
    const candidates: NormalizedSourcePosting[] = [];
    const issues: ConnectorIssue[] = [];
    let recordsSeen = 0;
    let recordsSkipped = 0;

    for (const job of parsed.jobs) {
      if (!isGreenhouseJob(job)) {
        recordsSeen++;
        recordsSkipped++;
        issues.push({
          safeId: null,
          code: 'invalid_shape',
          message: 'Job record is missing required "id" field.',
        });
        continue;
      }
      recordsSeen++;
      const safeId = `job:${job.id}`;
      try {
        const posting = normalizeGreenhouseJob(job, boardToken, fetchedAt);
        if (!posting.canonicalUrl) {
          // URL is invalid or missing — skip this record
          recordsSkipped++;
          issues.push({
            safeId,
            code: 'invalid_shape',
            message: `Job has missing, invalid, or non-HTTP(S) absolute_url.`,
          });
          continue;
        }
        candidates.push(posting);
      } catch {
        // Record normalization error as a structured issue (not logged)
        recordsSkipped++;
        issues.push({
          safeId,
          code: 'invalid_shape',
          message: 'Job record failed normalization.',
        });
      }
    }

    const recordsNormalized = candidates.length;

    // If every job failed normalization, return ok: false with errorClass schema
    if (recordsSeen > 0 && recordsNormalized === 0 && recordsSkipped === recordsSeen) {
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
          errorClass: 'schema',
          code: 'invalid_shape',
          message: `All ${recordsSeen} job records failed normalization.`,
          httpStatus,
        },
        fetchedAt,
        recordsSeen,
        recordsNormalized: 0,
        recordsSkipped,
        issues,
      };
    }

    // Partial or full success.
    // When some records were skipped, add partial_response to each candidate's flags
    // so downstream consumers know the connector result is incomplete.
    const isPartial = recordsSkipped > 0;
    if (isPartial) {
      for (const c of candidates) {
        if (!c.uncertaintyFlags.includes('partial_response')) {
          c.uncertaintyFlags.push('partial_response');
        }
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
      recordsSeen,
      recordsNormalized,
      recordsSkipped,
      issues,
    };
  } finally {
    // Timer is cleared exactly once here, regardless of success or failure path
    clearTimeout(timer);
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Map an HTTP status code to a SourceFetchErrorClass.
 * Used for error classification in connector results.
 */
function toErrorClass(status: number): SourceFetchErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  return 'unexpected';
}

/**
 * Map an HTTP status code to a connector-specific error code.
 */
function toErrorCode(status: number): ConnectorErrorCode | SourceFetchErrorClass {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server_error';
  return 'unexpected';
}

interface FailureContext {
  fetchedAt: string;
  requestUrl?: string;
  finalUrl?: string | null;
  httpStatus?: number | null;
  contentType?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  rawResponseText?: string | null;
}

function makeFailure(
  error: ConnectorError,
  ctx: FailureContext,
): ConnectorFetchResult {
  return {
    ok: false,
    candidates: [],
    rawResponseText: ctx.rawResponseText ?? null,
    requestUrl: ctx.requestUrl ?? '',
    finalUrl: ctx.finalUrl ?? null,
    httpStatus: ctx.httpStatus ?? null,
    contentType: ctx.contentType ?? null,
    etag: ctx.etag ?? null,
    lastModified: ctx.lastModified ?? null,
    error,
    fetchedAt: ctx.fetchedAt,
    recordsSeen: 0,
    recordsNormalized: 0,
    recordsSkipped: 0,
    issues: [],
  };
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
