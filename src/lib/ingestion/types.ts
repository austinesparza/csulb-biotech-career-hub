/**
 * Ingestion domain types for Phase 2A automated ingestion.
 * These types mirror the approved Phase 1 database contract (0003_automated_ingestion_schema.sql)
 * and are kept separate from public application types (src/lib/types.ts).
 *
 * Do NOT generate these from a live Supabase project.
 * Do NOT import Supabase clients here.
 */

// ============================================================
// ENUM TYPES (mirror SQL check constraints)
// ============================================================

/** Identifies which ATS or feed system the connector talks to. */
export type SourceKind =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'usajobs'
  | 'schema_org'
  | 'static_html'
  | 'rss'
  | 'other_api';

/** Lifecycle status of a source_fetch_runs row. */
export type SourceFetchRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled';

/** What initiated the fetch run. */
export type TriggerKind = 'scheduled' | 'manual' | 'retry' | 'recheck';

/** Current lifecycle status of a source posting. */
export type PostingStatus =
  | 'open'
  | 'missing'
  | 'closure_candidate'
  | 'closed'
  | 'reopened'
  | 'unknown';

/** How the posting's deadline should be interpreted. */
export type DeadlineKind = 'hard' | 'rolling' | 'unknown';

/** Work-location classification derived from job text and location fields. */
export type RemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown';

/**
 * High-level role classification.
 * Maps to the `classification` check constraint in source_postings.
 */
export type OpportunityClassification =
  | 'internship'
  | 'entry_level'
  | 'fellowship'
  | 'research'
  | 'other';

/**
 * Deduplication match classification used in DuplicateAssessment.
 * Separate from opportunity_source_links.match_type, which is the
 * curated-layer link type persisted after officer review.
 */
export type IngestionMatchType =
  | 'exact_identity'        // same connector kind + board token + external posting ID
  | 'exact_url'             // same canonical URL, different identity
  | 'probable_same_posting' // same employer + similar title + same normalized location
  | 'possible_annual_family' // same employer + title family (year/season stripped)
  | 'likely_distinct'       // fields differ enough to be independent postings
  | 'insufficient_information'; // not enough data to determine

/**
 * Persisted-link match type for opportunity_source_links.match_type.
 * Separate from IngestionMatchType (which is used for deduplication assessment).
 * These values map to the match_type check constraint in opportunity_source_links.
 */
export type PersistedLinkMatchType =
  | 'exact'           // canonical match: same source + identity
  | 'probable'        // officer confirmed probable duplicate
  | 'manual'          // manually linked by officer
  | 'annual_family'   // officer confirmed annual/recurring program family
  | 'alternate_source'; // same opportunity from a different source connector

/**
 * Flags that indicate uncertainty in a normalized field.
 * Stored in source_postings.uncertainty_flags (text[]).
 */
export type UncertaintyFlag =
  | 'location_missing'
  | 'location_ambiguous'
  | 'remote_ambiguous'
  | 'eligibility_missing'
  | 'eligibility_ambiguous'
  | 'classification_inferred'
  | 'deadline_missing'
  | 'deadline_invalid'
  | 'employment_type_missing'
  | 'description_missing'
  | 'employer_name_missing'
  | 'title_missing'
  | 'url_invalid'
  | 'partial_response';

// ============================================================
// ERROR TYPES (aligned with source_fetch_runs.error_class)
// ============================================================

/**
 * Error class matching the source_fetch_runs.error_class database check constraint.
 * These are the values that can be stored in the DB error_class column.
 *
 * Note: not_found, server_error, and response_oversized are connector-level codes,
 * not valid source_fetch_runs.error_class values. Use 'unexpected' or 'schema' for those.
 */
export type SourceFetchErrorClass =
  | 'network'
  | 'timeout'
  | 'robots'
  | 'auth'
  | 'schema'
  | 'rate_limit'
  | 'unexpected';

/**
 * Connector-specific stable error code.
 * Provides more granular information than SourceFetchErrorClass.
 * These codes are connector-internal and must not be stored directly in error_class.
 */
export type ConnectorErrorCode =
  | 'not_found'           // HTTP 404
  | 'server_error'        // HTTP 5xx
  | 'response_oversized'  // body exceeded maxResponseBytes
  | 'invalid_json'        // body is not valid JSON
  | 'invalid_shape'       // JSON does not match expected schema
  | 'invalid_config'      // configuration parameter is invalid
  | 'redirect_rejected';  // 3xx response rejected per redirect policy

// ============================================================
// NORMALIZED POSTING
// ============================================================

/**
 * Common normalized shape produced by any connector.
 * Each field has a raw counterpart so no source data is silently discarded.
 *
 * This is the TypeScript representation of a source_postings row
 * plus its associated score breakdown — before any Supabase write.
 */
export interface NormalizedSourcePosting {
  // --- Identity (stable across content changes) ---
  /** Deterministic key: `{sourceKind}:{boardToken}:{externalPostingId}` */
  identityKey: string;
  /**
   * SHA-256 of material fields (title, location, URL, deadline, departments, offices).
   * Changes only when officer-review-worthy fields change.
   * Must be exactly 64 lowercase hex characters.
   */
  materialHash: string;
  /** Semantic version string for the connector logic that produced this posting. */
  connectorVersion: string;
  sourceKind: SourceKind;

  // --- External IDs ---
  /** ATS-assigned job post ID (string representation of numeric or string id). */
  externalPostingId: string | null;
  /** ATS internal job requisition ID. */
  internalJobId: string | null;
  /** Human-readable requisition/job-req number. */
  requisitionId: string | null;

  // --- Employer ---
  employerNameRaw: string | null;
  employerNameNormalized: string | null;

  // --- Title ---
  titleRaw: string | null;
  titleNormalized: string | null;

  // --- Location ---
  locationRaw: string | null;
  locationNormalized: string | null;

  // --- URL ---
  /** Canonical posting URL (required; must not be empty). */
  canonicalUrl: string;

  // --- Classification ---
  remoteType: RemoteType;
  employmentType: string | null;
  classification: OpportunityClassification;

  // --- Department / Focus ---
  /** Primary department name (first if multiple). */
  department: string | null;
  /** All department names, sorted. */
  departments: string[];
  /** All office/location names, sorted. */
  offices: string[];
  /** Derived focus area tag. */
  focusArea: string | null;

  // --- Dates ---
  /** ISO YYYY-MM-DD or null. */
  postedAt: string | null;
  /** ISO YYYY-MM-DD or null. */
  closesAt: string | null;
  deadlineKind: DeadlineKind;

  // --- Content ---
  /** Plain-text description derived from HTML content, or null. */
  descriptionText: string | null;
  language: string | null;

  // --- Source metadata ---
  /**
   * ISO timestamp of the last update per the source ATS (e.g. Greenhouse updated_at).
   * Null when not provided by the source.
   */
  sourceUpdatedAt: string | null;
  /**
   * Structured metadata from the source (e.g. Greenhouse metadata[] array).
   * Stored as a parsed value for normalized_json storage.
   * Null when not provided. Must not be included in scoring unless explicitly supported.
   */
  sourceMetadata: unknown | null;

  // --- Scoring ---
  relevanceScore: number;
  relevanceScoreVersion: number;
  scoreBreakdown: ScoreBreakdown;

  // --- Uncertainty ---
  uncertaintyFlags: UncertaintyFlag[];

  // --- Fetch metadata ---
  /** ISO timestamp when this posting was fetched. */
  fetchedAt: string;
}

// ============================================================
// SCORE BREAKDOWN
// ============================================================

/** A single scoring contribution (positive or negative). */
export interface ScoreReason {
  category: string;
  points: number;
  reason: string;
}

/**
 * Complete score breakdown for a normalized posting.
 * version must always match the relevanceScoreVersion on the posting.
 */
export interface ScoreBreakdown {
  /** Score version (positive integer). Currently 1. */
  version: number;
  /** Clamped final score: 0–100. */
  total: number;
  /** Raw pre-clamp score for debugging. */
  rawTotal: number;
  positiveReasons: ScoreReason[];
  negativeReasons: ScoreReason[];
  /**
   * Uncertainty flags derived or carried through by the scorer.
   * Includes any flags from the input plus any derived by the scoring function
   * (e.g. eligibility_missing, eligibility_ambiguous).
   */
  uncertaintyFlags: UncertaintyFlag[];
}

// ============================================================
// DUPLICATE ASSESSMENT
// ============================================================

/**
 * Pure assessment of whether an ingestion candidate is a duplicate
 * of an existing source posting. Does not mutate any records.
 *
 * Officers must review when requiresOfficerReview is true.
 * No automatic merge, publication, or record creation is performed here.
 */
export interface DuplicateAssessment {
  matchType: IngestionMatchType;
  /** Confidence in the match: 0.0 (none) to 1.0 (certain). */
  confidence: number;
  /** Identity key of the best-matched existing posting, or null when no match. */
  matchedIdentityKey: string | null;
  /** Field names that contributed to the match determination. */
  contributingFields: string[];
  /** Field names whose values conflict between the two postings. */
  conflictingFields: string[];
  /** Human-readable explanation of the match determination. */
  reasons: string[];
  /** True when the match classification or confidence warrants officer review. */
  requiresOfficerReview: boolean;
}

// ============================================================
// CONNECTOR RESULT
// ============================================================

/**
 * A per-record issue encountered during normalization.
 * Used when some records succeed and others fail (partial result).
 * Must not include raw descriptions or PII in the message.
 */
export interface ConnectorIssue {
  /** Safe identifier for the affected record (e.g. job ID or title stub), or null. */
  safeId: string | null;
  /** Stable machine-readable issue code. */
  code: ConnectorErrorCode;
  /** Human-readable non-sensitive description of the issue. */
  message: string;
}

/**
 * Typed error returned by a connector when a fetch cannot succeed.
 * Callers must not throw unstructured strings; use this type instead.
 *
 * errorClass maps to the source_fetch_runs.error_class database check constraint.
 * code provides connector-specific granular information and must not be stored
 * directly in error_class.
 */
export interface ConnectorError {
  /** Maps to source_fetch_runs.error_class. */
  errorClass: SourceFetchErrorClass;
  /** Connector-specific stable code (more granular than errorClass). */
  code: ConnectorErrorCode | SourceFetchErrorClass;
  message: string;
  httpStatus?: number;
}

/**
 * The complete result of a single connector fetch operation.
 * Discriminated union on `ok`:
 *   - ok: true  → candidates present, error null
 *   - ok: false → candidates empty, error present
 *
 * rawResponseText is captured when safely available for provenance storage.
 * Never log rawResponseText in production.
 *
 * issues may be non-empty even when ok: true (partial normalization failures).
 */
export type ConnectorFetchResult = ConnectorFetchSuccess | ConnectorFetchFailure;

interface ConnectorFetchBase {
  /**
   * Raw response body text, preserved for payload storage.
   * Bounded to maxResponseBytes; null when unavailable or oversized.
   * Never log this value in production.
   */
  rawResponseText: string | null;
  /** The URL used to make the request. */
  requestUrl: string;
  /** Final URL after any redirects, if available. */
  finalUrl: string | null;
  httpStatus: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  /** ISO timestamp when this fetch was initiated. */
  fetchedAt: string;
  /** Total number of raw records seen in the response (before filtering/normalization). */
  recordsSeen: number;
  /** Number of records that were successfully normalized. */
  recordsNormalized: number;
  /** Number of records skipped due to normalization errors or invalid data. */
  recordsSkipped: number;
  /** Per-record issues encountered during normalization. Never contains raw descriptions. */
  issues: ConnectorIssue[];
}

export interface ConnectorFetchSuccess extends ConnectorFetchBase {
  ok: true;
  /** All normalized candidates produced from this fetch. May be empty for empty boards. */
  candidates: NormalizedSourcePosting[];
  error: null;
}

export interface ConnectorFetchFailure extends ConnectorFetchBase {
  ok: false;
  /** Always empty on failure. */
  candidates: [];
  error: ConnectorError;
}

// ============================================================
// INGESTION CANDIDATE
// ============================================================

/**
 * A fully-processed ingestion candidate, ready for comparison against
 * existing source_postings and officer review queue creation.
 *
 * This is the output of the ingestion core pipeline before any DB write.
 */
export interface IngestionCandidate {
  posting: NormalizedSourcePosting;
  /**
   * Duplicate assessment against a provided set of existing postings.
   * Null when no comparison set was provided (e.g., first-ever fetch).
   */
  duplicateAssessment: DuplicateAssessment | null;
  fetchedAt: string;
}

// ============================================================
// CONNECTOR INPUT
// ============================================================

/** Configuration passed to the Greenhouse connector. */
export interface GreenhouseConnectorConfig {
  /** Board token (e.g. "mycompany"). Validated before use. */
  boardToken: string;
  /**
   * Fetch timeout in milliseconds. Defaults to 30 000.
   * Must be a finite integer in the range [100, 120000].
   */
  timeoutMs?: number;
  /**
   * Maximum response size in bytes. Defaults to 10 485 760 (10 MiB).
   * Must be a finite integer in the range [1024, 20971520].
   */
  maxResponseBytes?: number;
  /**
   * Dependency-injected fetch function for testing.
   * Defaults to the global fetch.
   */
  fetchFn?: typeof fetch;
}
