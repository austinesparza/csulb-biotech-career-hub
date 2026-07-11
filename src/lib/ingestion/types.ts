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
  | 'exact_identity'       // same connector kind + board token + external posting ID
  | 'exact_url'            // same canonical URL, different identity
  | 'probable_same_posting' // same employer + similar title + same location
  | 'possible_annual_family' // same employer + title family (year/season stripped)
  | 'likely_distinct'      // fields differ enough to be independent postings
  | 'insufficient_information'; // not enough data to determine

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
  | 'employer_name_missing';

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
 * Typed error returned by a connector when a fetch cannot succeed.
 * Callers must not throw unstructured strings; use this type instead.
 *
 * `kind` maps to the error_class check constraint in source_fetch_runs.
 */
export interface ConnectorError {
  kind:
    | 'network'
    | 'timeout'
    | 'robots'
    | 'auth'
    | 'schema'
    | 'rate_limit'
    | 'not_found'
    | 'server_error'
    | 'oversized'
    | 'unexpected';
  message: string;
  httpStatus?: number;
}

/**
 * The complete result of a single connector fetch operation.
 *
 * When ok is true, candidates contains all normalized postings from the response.
 * When ok is false, error describes what went wrong.
 * rawResponseText is always captured when available for provenance storage.
 */
export interface ConnectorFetchResult {
  ok: boolean;
  /** All normalized candidates produced from this fetch. Empty on error. */
  candidates: NormalizedSourcePosting[];
  /**
   * Raw response body text, preserved for payload storage.
   * May be truncated if the response exceeded the size limit.
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
  error: ConnectorError | null;
  /** ISO timestamp when this fetch was initiated. */
  fetchedAt: string;
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
  /** Fetch timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Maximum response size in bytes. Defaults to 10 485 760 (10 MiB). */
  maxResponseBytes?: number;
  /**
   * Dependency-injected fetch function for testing.
   * Defaults to the global fetch.
   */
  fetchFn?: typeof fetch;
}
