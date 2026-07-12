# Ingestion Core — Greenhouse Phase 2A

This document describes the automated ingestion core and Greenhouse connector
implemented in Phase 2A. The output of this phase is normalized ingestion
candidates and decision metadata. **No database writes are performed in this
phase.**

---

## Module Structure

```
src/lib/ingestion/
├── types.ts          — Domain types (enums, interfaces, connectorconfig)
├── normalize.ts      — Pure normalization functions
├── hash.ts           — Stable JSON serialization + SHA-256 + identity keys
├── score.ts          — Deterministic relevance scoring v1
├── dedupe.ts         — Pure duplicate assessment (no mutations)
└── connectors/
    └── greenhouse.ts — Greenhouse Job Board connector

src/__tests__/ingestion/
├── fixtures/
│   ├── greenhouse-normal.json                           — 7 representative jobs
│   ├── greenhouse-changed-deadline.json                 — same job, deadline changed
│   ├── greenhouse-changed-title.json                    — same job, title changed
│   ├── greenhouse-same-content-different-key-order.json — identical material, different layout
│   ├── greenhouse-empty.json                            — empty jobs array
│   ├── greenhouse-invalid-json.txt                      — malformed JSON
│   └── greenhouse-invalid-shape.json                    — missing "jobs" array
├── normalize.test.ts
├── hash.test.ts
├── score.test.ts
├── dedupe.test.ts
└── greenhouse.test.ts

docs/
└── ingestion-core-greenhouse.md  — this file
```

---

## Normalized Posting Contract (`NormalizedSourcePosting`)

Every connector produces `NormalizedSourcePosting` objects. Key invariants:

| Field | Type | Notes |
|---|---|---|
| `identityKey` | `string` | Deterministic; stable across content changes |
| `materialHash` | `string` | 64-char lowercase SHA-256; changes only on material field change |
| `connectorVersion` | `string` | Semver of the connector that produced this posting |
| `sourceKind` | `SourceKind` | Always `"greenhouse"` for this connector |
| `externalPostingId` | `string \| null` | Greenhouse job post ID |
| `internalJobId` | `string \| null` | Greenhouse internal job ID |
| `requisitionId` | `string \| null` | HR requisition number |
| `employerNameRaw` | `string \| null` | Raw employer name (null for Greenhouse list endpoint) |
| `employerNameNormalized` | `string \| null` | Lowercase, suffixes stripped |
| `titleRaw` | `string \| null` | Original title as fetched |
| `titleNormalized` | `string \| null` | Lowercase, Unicode-aware punctuation stripped, entities decoded |
| `locationRaw` | `string \| null` | Original location as fetched |
| `locationNormalized` | `string \| null` | Lowercase, Unicode-aware punctuation stripped |
| `canonicalUrl` | `string` | Canonical URL (tracking params removed case-insensitively, fragment removed) |
| `remoteType` | `RemoteType` | `remote` \| `hybrid` \| `onsite` \| `unknown` |
| `employmentType` | `string \| null` | Not available in Greenhouse list endpoint |
| `classification` | `OpportunityClassification` | `internship` \| `fellowship` \| `research` \| `entry_level` \| `other` |
| `department` | `string \| null` | Primary (first) department |
| `departments` | `string[]` | All departments, sorted |
| `offices` | `string[]` | All offices, sorted |
| `focusArea` | `string \| null` | Inferred from title and description |
| `postedAt` | `string \| null` | ISO YYYY-MM-DD (from `first_published`) |
| `closesAt` | `string \| null` | ISO YYYY-MM-DD (from `application_deadline`) |
| `deadlineKind` | `DeadlineKind` | `hard` \| `rolling` \| `unknown` |
| `descriptionText` | `string \| null` | Plain text from HTML content |
| `language` | `string \| null` | Language code from API |
| `sourceUpdatedAt` | `string \| null` | Raw `updated_at` value from Greenhouse API |
| `sourceMetadata` | `unknown[] \| null` | Raw `metadata` array from Greenhouse API, if present |
| `relevanceScore` | `number` | 0–100 clamped |
| `relevanceScoreVersion` | `number` | Positive integer; currently 1 |
| `scoreBreakdown` | `ScoreBreakdown` | Full scoring breakdown including derived `uncertaintyFlags` |
| `uncertaintyFlags` | `UncertaintyFlag[]` | Fields that could not be determined |
| `fetchedAt` | `string` | ISO timestamp of the fetch operation |

Raw values are always preserved separately from normalized values. Normalization
never discards source data.

---

## Greenhouse Field Mapping

| Greenhouse API field | NormalizedSourcePosting field | Notes |
|---|---|---|
| `jobs[n].id` | `externalPostingId` | Stringified numeric ID |
| `jobs[n].internal_job_id` | `internalJobId` | Stringified, null if absent |
| `jobs[n].requisition_id` | `requisitionId` | Null if absent |
| `jobs[n].title` | `titleRaw` / `titleNormalized` | Entities decoded, HTML stripped |
| `jobs[n].location.name` | `locationRaw` / `locationNormalized` | Null if location object missing |
| `jobs[n].absolute_url` | `canonicalUrl` | Tracking params removed, fragment removed; record skipped if invalid |
| `jobs[n].updated_at` | `sourceUpdatedAt` | Preserved as raw string for provenance; excluded from material hash |
| `jobs[n].content` | `descriptionText` | HTML stripped, entities decoded; normalized text included in material hash |
| `jobs[n].departments[].name` | `departments` | Sorted array; first element → `department` |
| `jobs[n].offices[].name` | `offices` | Sorted array |
| `jobs[n].first_published` | `postedAt` | Parsed to ISO date |
| `jobs[n].application_deadline` | `closesAt` | Parsed to ISO date or null |
| `jobs[n].language` | `language` | Preserved as-is |
| `jobs[n].metadata` | `sourceMetadata` | Preserved as raw array for provenance; not included in scoring |
| `jobs[n].content` | `descriptionText` | Also used for eligibility and remote-type inference |

`employerNameRaw` and `employerNameNormalized` are **null** for the Greenhouse
jobs-list endpoint, which does not include employer name per job. The caller
(Phase 2B worker) that knows the board's employer name should enrich these
fields before storing. The `employer_name_missing` uncertainty flag is set on
every job from this connector.

Individual job-detail requests (`GET /v1/boards/{token}/jobs/{id}`) are **not**
made in Phase 2A to avoid N+1 fetches. They are deferred to Phase 2B.

---

## Identity Key Algorithm

```
identity_key = "greenhouse:" + lowercase(boardToken) + ":" + String(jobPostId)
```

Examples:
- Board token `labgenomicsinc`, job ID `1001001` → `greenhouse:labgenomicsinc:1001001`

**Stability guarantees:**
- Does not change when title, location, content, description, or fetch time changes.
- Does not change when `updated_at` or `first_published` changes.
- Does change when the board token or job post ID changes.
- Board token is lowercased to avoid case-drift between fetches.

This maps to the `identity_key` column in `source_postings` (unique per `job_source_id`).

---

## Material Hash Field List

The material hash (`SHA-256(stableSerialize(materialFields))`) includes these
fields and **only** these fields:

| Field | Reason |
|---|---|
| `titleRaw` | Most important public-facing field |
| `locationRaw` | Officer-visible location |
| `canonicalUrl` | Direct link to the posting |
| `departments` | Sorted array of department names |
| `offices` | Sorted array of office names |
| `closesAt` | Parsed application deadline (ISO date or null) |
| `deadlineKind` | Interpretation of the deadline |
| `descriptionNormalized` | Plain-text description (HTML stripped, whitespace normalized); HTML-only formatting changes do not alter the hash |
| `employmentType` | Employment type if available |
| `classification` | Opportunity classification |
| `remoteType` | Remote/hybrid/onsite classification |

**Excluded from material hash:**
- `fetchedAt`, `first_seen_at`, `last_seen_at` — fetch metadata; changes every run
- `identityKey` — identity itself
- `relevanceScore`, `scoreBreakdown` — computed, not sourced
- `uncertaintyFlags` — computed, not sourced
- `connectorVersion` — infrastructure, not content
- `materialHash` — circular
- `internalJobId` — Greenhouse internal restructuring ID
- `language` — locale metadata
- `externalPostingId` — part of identity
- `requisitionId` — internal HR tracking; changes do not indicate public content change
- `sourceUpdatedAt` / `updated_at` — Greenhouse timestamp; changes on any server-side edit
- `sourceMetadata` — arbitrary metadata not yet scored or reviewed

The `stableSerialize` function sorts object keys recursively before serializing,
so the material hash is invariant to JSON key ordering differences between
fetches.

---

## Redirect Policy

The connector sets `redirect: 'manual'` on every fetch request. Any 3xx
response (301, 302, 307, 308, etc.) is **rejected immediately** with:

```
errorClass: 'unexpected'
code: 'redirect_rejected'
httpStatus: <3xx status>
```

No second network request is made. This prevents open-redirect attacks and
ensures the connector only communicates with the configured Greenhouse API
endpoint.

---

## Full-Operation Timeout

The `AbortController` timer is started **before** the fetch call and is cleared
in the `finally` block **after the entire operation completes** (including fetch,
body stream reading, JSON parsing, and record normalization). The timer covers:

1. Waiting for the server to send response headers
2. Streaming the response body
3. Parsing JSON
4. Normalizing records

If the body stream stalls after headers are received, the timeout will still
fire and abort the stream. The connector returns:

```
errorClass: 'timeout'
code: 'timeout'
```

The timer is cleared exactly once (in `finally`), regardless of whether the
operation succeeds or fails.

---

## Bounded Non-2xx Response Bodies

For non-2xx responses, the connector reads up to `min(maxResponseBytes, 65536)`
bytes of the response body using the same bounded stream reader. The raw text is
preserved in the result for provenance tracing but is **never logged**.

If the error body exceeds the limit, it is silently discarded. The `response.ok`
check is performed before reading — the error class is determined from the HTTP
status code, not the body content.

Unbounded `response.text()` is never called.

---

## Configuration Bounds

| Parameter | Valid range | Default | Error on violation |
|---|---|---|---|
| `timeoutMs` | 100–120000 (integer) | 30000 | `invalid_config` |
| `maxResponseBytes` | 1024–20971520 (integer) | 10485760 | `invalid_config` |

Zero, negative, NaN, Infinity, fractional, or out-of-range values are rejected
with `errorClass: 'schema'`, `code: 'invalid_config'` before any network call
is made. Caller configuration cannot disable or bypass these safety limits.

---

## Record-Level Issues (`ConnectorIssue`)

When individual records fail normalization, the connector does **not** silently
drop them. Instead, a `ConnectorIssue` is appended to `result.issues`:

```typescript
interface ConnectorIssue {
  safeId: string | null;   // e.g. "job:1001001"
  code: ConnectorErrorCode; // stable machine-readable code
  message: string;          // non-sensitive human-readable description
}
```

The result also includes:
- `recordsSeen` — total jobs in the API response
- `recordsNormalized` — jobs that produced a valid `NormalizedSourcePosting`
- `recordsSkipped` — jobs that were skipped due to issues

**Partial success:** if some records succeed and some fail, `ok: true` is
returned with the valid candidates plus the issue list. Phase 2B can mark the
run as partial.

**All-invalid:** if every record fails normalization, `ok: false` is returned
with `errorClass: 'schema'`, `code: 'invalid_shape'`.

Raw job descriptions are **never** included in issue messages.

---

## No Fabricated Canonical URLs

If `absolute_url` is missing, null, malformed, or uses a non-HTTP(S) scheme
(e.g. `javascript:`, `ftp://`), the connector does **not** fabricate a fallback
URL. The record is skipped with a `ConnectorIssue` (`code: 'invalid_shape'`).

The old fallback `https://boards-api.greenhouse.io/jobs/{id}` has been removed.

---

## errorClass vs Connector Code

| Situation | `errorClass` | `code` |
|---|---|---|
| Network failure | `network` | `network` |
| Abort / timeout | `timeout` | `timeout` |
| 301/302 redirect | `unexpected` | `redirect_rejected` |
| 401 Unauthorized | `auth` | `auth` |
| 404 Not Found | `unexpected` | `not_found` |
| 429 Too Many Requests | `rate_limit` | `rate_limit` |
| 5xx Server Error | `unexpected` | `server_error` |
| Response too large | `schema` | `response_oversized` |
| Body is not valid JSON | `schema` | `invalid_json` |
| JSON does not match shape | `schema` | `invalid_shape` |
| Invalid config value | `schema` | `invalid_config` |

`errorClass` maps directly to the `error_class` column in `source_fetch_runs`
(Phase 1 contract). `code` is a more specific, connector-level code that does
not map to the DB enum directly.

---

## Scoring Version 1

**Score range:** 0–100 (clamped)
**Score version:** 1 (increment when logic changes)
**Baseline:** 40 points before adjustments

### Positive categories

| Category | Max points | Trigger |
|---|---|---|
| `biotech_relevance` | +20 (strong), +10 (moderate) | Biotech/life-science title terms |
| `biotech_relevance` | +8 | Biotech/life-science department |
| `undergrad_access` | +15 | Explicit undergraduate eligibility language |
| `undergrad_access` | +8 | Recent-graduate language |
| `role_type` | +15 | Classification = internship |
| `role_type` | +12 | Classification = fellowship |
| `role_type` | +10 | Classification = entry_level |
| `role_type` | +8 | Classification = research |
| `geography` | +12 | Southern California location |
| `geography` | +10 | Remote |
| `geography` | +6 | Hybrid |
| `deadline` | +5 | Deadline within 90 days |

### Negative categories

| Category | Points | Trigger |
|---|---|---|
| `seniority` | −25 | VP, director, head of, principal, staff engineer |
| `seniority` | −15 | Senior, lead, manager |
| `degree_req` | −20 | PhD, MD, postdoc **required** |
| `degree_req` | −8 | Master's preferred/required |
| `undergrad_access` | −15 | "Graduate students only" |
| `unrelated_dept` | −20 | Clearly unrelated department (retail, HR, sales, etc.) |
| `eligibility` | −5 | Eligibility information missing or ambiguous |
| `link_quality` | −10 | No application URL |
| `deadline` | −15 | Deadline has passed |

### Scoring safeguards

- **Southern California detection** uses token-boundary regex patterns. Generic
  substrings like `"la"` are not used (would match Atlanta, Malaysia, etc.).
  Only explicit city/county names are matched.
- **Undergraduate eligibility** requires student-context phrases such as
  `"college junior"`, `"rising senior"`, `"junior standing"`. Generic
  `"junior"` or `"senior"` in a job title do not trigger the undergrad bonus.
- **"Fellow"** is not treated as a seniority signal. Postdoctoral Fellow and
  Research Fellowship positions are not penalized for seniority.
- **Degree requirements** distinguish required from preferred/contextual.
  `"PhD preferred"`, `"BS/MS/PhD accepted"`, and `"works with PhD scientists"`
  do not trigger the degree penalty. Only explicit required/minimum
  qualifications do.
- **Deadline scoring** uses the injected `now` parameter, not the wall clock.
  Pass an explicit `Date` in tests for deterministic results.

### Eligibility flag derivation

The scorer derives `eligibility_missing` and `eligibility_ambiguous` from the
description when they are not already present in `uncertaintyFlags`:

- `eligibility_missing` — set when `descriptionText` is null or empty
- `eligibility_ambiguous` — set when description exists but contains no clear
  accessibility or exclusion signals

These flags are included in `ScoreBreakdown.uncertaintyFlags` (the original
input flags plus any scorer-derived flags).

---

## Duplicate Assessment

The `assessDuplicate` function in `src/lib/ingestion/dedupe.ts` is a pure
function that takes a candidate and a list of existing postings and returns a
`DuplicateAssessment` with:

- `matchType` — classification from `IngestionMatchType`
- `confidence` — 0.0–1.0
- `matchedIdentityKey` — identity key of the best-matched existing posting, or null
- `contributingFields` — fields that triggered the match
- `conflictingFields` — fields that differ between the two postings
- `reasons` — human-readable explanation
- `requiresOfficerReview` — true when officer intervention is needed

### Match priority (highest to lowest)

| Match type | Confidence | Trigger | Officer review? |
|---|---|---|---|
| `exact_identity` | 1.0 | Same identity key | Only if content changed |
| `exact_url` | 0.95 | Same canonical URL, different identity | Always |
| `probable_same_posting` | ~0.85–0.90 | Same employer (≥85%) + similar title (≥85%) + same location | Always |
| `possible_annual_family` | 0.6 | Same employer + family title matches, raw title differs | Always |
| `likely_distinct` | 0.9 | No match found | Never |
| `insufficient_information` | 0.0 | No existing postings, or employer/title missing | Never |

### Dedupe location requirement

`probable_same_posting` requires that the candidate and the existing posting
have the **same normalized location**, or that both locations are null. A
conflicting non-null location disqualifies the match — the result falls through
to `possible_annual_family` or `likely_distinct`.

### Best-match selection

When multiple candidates qualify for the same match type, the assessor evaluates
all of them and selects the best match by highest confidence. Ties are broken
deterministically by lexicographic order of the existing posting's `identityKey`.
This ensures the same best match is returned regardless of the input order of
existing postings.

### Exact identity with changed materialHash

For `exact_identity` matches:
- Same `materialHash` → `requiresOfficerReview: false`, reason says "content not modified"
- Different `materialHash` → `requiresOfficerReview: true`, reason says "content was modified"
- The reason never claims content is unchanged when the hash differs.

---

## Uncertainty Handling

When a field cannot be reliably determined, a `UncertaintyFlag` is added to
`uncertaintyFlags` on the posting. The normalized field is set to `null` rather
than a guess.

| Flag | Cause |
|---|---|
| `employer_name_missing` | Greenhouse list endpoint does not include employer name |
| `location_missing` | `location.name` absent or null in API response |
| `location_ambiguous` | Location string is ambiguous (future use) |
| `remote_ambiguous` | Contradictory remote and onsite signals, or no signal with no location |
| `classification_inferred` | Classification was inferred from title/description, not explicit |
| `deadline_missing` | `application_deadline` absent or null |
| `deadline_invalid` | `application_deadline` present but not parseable as a date |
| `description_missing` | `content` absent, null, or empty |
| `employment_type_missing` | Not available in Greenhouse list endpoint |
| `title_missing` | Title absent or empty |
| `url_invalid` | `absolute_url` missing, malformed, or non-HTTP(S) |
| `partial_response` | Some records failed normalization (partial result) |
| `eligibility_missing` | Description absent — eligibility cannot be assessed |
| `eligibility_ambiguous` | Description present but contains no clear eligibility signals |

Flags do **not** prevent the candidate from being returned; they provide context
for officer review and score adjustments.

---

## Connector Timeout and Response-Size Behavior

| Parameter | Valid range | Default | Override via |
|---|---|---|---|
| Fetch timeout | 100–120000 ms (integer) | 30000 | `config.timeoutMs` |
| Max response bytes | 1024–20971520 (integer) | 10485760 | `config.maxResponseBytes` |

**Timeout:** covers the complete operation — headers, body stream, JSON
parsing, and normalization. The timer is cleared exactly once in the `finally`
block. If the body stream stalls after headers are received, the timeout fires.

**Response size:** the response body is read via `ReadableStream.getReader()`.
If the accumulated byte count exceeds `maxResponseBytes`, reading is cancelled
and a `ConnectorError` with `code: "response_oversized"` is returned.

**Non-2xx responses:** up to 64 KiB of the error body is read using the same
bounded reader for provenance. The raw text is never logged.

---

## Security Boundaries

- **No authentication.** The Greenhouse jobs-list endpoint is public.
- **No application submission.** The connector only reads job listings.
- **No arbitrary URL fetching.** The board token is validated before URL
  construction. The URL is always built internally from the validated token.
- **No raw response body logging.** `rawResponseText` is stored for provenance
  but must never be logged.
- **No Supabase client.** No database writes or reads in this phase.
- **No secrets or credentials.** The connector requires no API keys.
- **No service-role client.** Deferred to Phase 2B worker.
- **No redirect following.** `redirect: 'manual'` is set. All 3xx responses are
  rejected. No second request to an arbitrary host is made.
- **No fabricated URLs.** Records with missing/invalid `absolute_url` are
  skipped with a structured issue. No fallback URLs are constructed.
- **Board token allowlist:** only letters, digits, hyphens, and underscores
  (max 128 chars). Tokens starting with a hyphen are rejected.
- **Fetch dependency injection:** `config.fetchFn` allows tests to use a mock
  fetch without touching the live Greenhouse API.

---

## Test Fixture Policy

Fixtures contain **invented organizations and jobs** — no real company names,
real job IDs, or copied live job descriptions.

Fixture files live in `src/__tests__/ingestion/fixtures/` and are checked into
the repository. They serve as a stable, network-free regression baseline.

| Fixture | Purpose |
|---|---|
| `greenhouse-normal.json` | 7 representative jobs (internship, entry-level, senior role, remote, hybrid, missing location, missing description/bad date) |
| `greenhouse-changed-deadline.json` | Same job 1001001, different `application_deadline` |
| `greenhouse-changed-title.json` | Same job 1001001, changed title |
| `greenhouse-same-content-different-key-order.json` | Same material fields for job 1001001, JSON keys in different order |
| `greenhouse-empty.json` | Zero jobs in response |
| `greenhouse-invalid-json.txt` | Malformed JSON (truncated) |
| `greenhouse-invalid-shape.json` | Valid JSON but missing `jobs` array |

**Fixture naming convention:** `greenhouse-{scenario}.{json|txt}`

Tests must never make live network requests. Any test that triggers a real
`fetch` to `boards-api.greenhouse.io` is a bug. The connector's `fetchFn`
parameter enables complete network isolation.

---

## Validation Commands

```bash
# Install dependencies
npm ci

# Run all tests (274 tests, no live network)
npm test

# TypeScript type checking
npm run typecheck

# Production build
npm run build

# Git whitespace check
git diff --check
```

---

## Deferred Work (Phase 2B and Later)

The following items are explicitly out of scope for Phase 2A and should be
addressed in later phases:

| Item | Phase |
|---|---|
| Supabase database writes (`source_postings`, `source_posting_versions`) | Phase 2B |
| Service-role client and Supabase credentials | Phase 2B |
| Edge Function worker that calls this connector | Phase 2B/3 |
| Supabase Cron scheduling | Phase 3 |
| Individual job-detail fetching (`GET /v1/boards/{token}/jobs/{id}`) | Phase 2B |
| Employer name enrichment from board-level metadata | Phase 2B |
| Lever, Ashby, USAJOBS, RSS, schema.org, HTML connectors | Phase 2B+ |
| Admin UI for source management (`job_sources`) | Phase 7 |
| Review task creation (`review_tasks`) | Phase 2B |
| Opportunity creation from approved candidates | Phase 2B |
| Score version 2+ (recalibrated weights based on officer feedback) | Post-launch |
| Concurrent safety testing for `claim_source_fetch_runs` | Phase 2B |
| robots.txt compliance checking | Phase 2B |
| Production environment variables | Phase 2B |
| Automatic opportunity publication | Never (requires officer approval) |

---

## Design Decisions

**Why Vitest?** Minimal configuration, TypeScript-native, Node.js environment,
no Babel required. Appropriate for a small, officer-maintained student project.

**Why no employer name from Greenhouse?** The Greenhouse jobs-list endpoint
(`/v1/boards/{token}/jobs?content=true`) does not include employer name in
individual job objects. The board-level employer name is available at
`/v1/boards/{token}` (a separate request). To avoid an extra N+1-style
preambule request, the employer name is left null and flagged with
`employer_name_missing`. The calling worker in Phase 2B should resolve this
before storage.

**Why is `updated_at` excluded from the material hash but `descriptionNormalized`
included?** `updated_at` changes on any Greenhouse-side edit (including internal
edits that do not affect public content) and is not meaningful to officers.
`descriptionNormalized` (HTML stripped, whitespace normalized) ensures that
meaningful text changes are detected, while HTML-only formatting changes (bold,
italic, whitespace) do not alter the hash.

**Why are `UncertaintyFlag` values deduplicated?** The same flag can be
produced by multiple independent checks. The connector deduplicates flags with
`[...new Set(flags)]` before storing to keep the array clean for officers.

**Why does `normalizeJobTitle` strip `&` from titles?** The normalization
pipeline decodes HTML entities (so `&amp;` becomes `&`) and then strips
non-word characters for comparison. This is consistent with the existing
`normalizeTitle` function in `src/lib/normalize.ts`. Raw titles (which preserve
the decoded `&`) are stored separately in `titleRaw`.

**Schema alignment:** The TypeScript types in `src/lib/ingestion/types.ts`
mirror the Phase 1 database contract in
`supabase/migrations/0003_automated_ingestion_schema.sql`. No schema
incompatibilities were found. The `source_kind` check constraint in SQL uses
`'greenhouse'` which matches `SourceKind = 'greenhouse'` in TypeScript. The
`classification` check constraint values (`internship`, `entry_level`,
`fellowship`, `research`, `other`) all match `OpportunityClassification`. The
`deadline_kind` values (`hard`, `rolling`, `unknown`) match `DeadlineKind`. The
`remote_type` values (`remote`, `hybrid`, `onsite`, `unknown`) match `RemoteType`.

**Vitest placement:** Vitest is correctly placed in `devDependencies` in
`package.json`. It is not a production dependency. The lockfile reflects this
placement without changes.


This document describes the automated ingestion core and Greenhouse connector
implemented in Phase 2A. The output of this phase is normalized ingestion
candidates and decision metadata. **No database writes are performed in this
phase.**

---

## Module Structure

```
src/lib/ingestion/
├── types.ts          — Domain types (enums, interfaces, connectorconfig)
├── normalize.ts      — Pure normalization functions
├── hash.ts           — Stable JSON serialization + SHA-256 + identity keys
├── score.ts          — Deterministic relevance scoring v1
├── dedupe.ts         — Pure duplicate assessment (no mutations)
└── connectors/
    └── greenhouse.ts — Greenhouse Job Board connector

src/__tests__/ingestion/
├── fixtures/
│   ├── greenhouse-normal.json                           — 7 representative jobs
│   ├── greenhouse-changed-deadline.json                 — same job, deadline changed
│   ├── greenhouse-changed-title.json                    — same job, title changed
│   ├── greenhouse-same-content-different-key-order.json — identical material, different layout
│   ├── greenhouse-empty.json                            — empty jobs array
│   ├── greenhouse-invalid-json.txt                      — malformed JSON
│   └── greenhouse-invalid-shape.json                    — missing "jobs" array
├── normalize.test.ts
├── hash.test.ts
├── score.test.ts
├── dedupe.test.ts
└── greenhouse.test.ts

docs/
└── ingestion-core-greenhouse.md  — this file
```

---

## Normalized Posting Contract (`NormalizedSourcePosting`)

Every connector produces `NormalizedSourcePosting` objects. Key invariants:

| Field | Type | Notes |
|---|---|---|
| `identityKey` | `string` | Deterministic; stable across content changes |
| `materialHash` | `string` | 64-char lowercase SHA-256; changes only on material field change |
| `connectorVersion` | `string` | Semver of the connector that produced this posting |
| `sourceKind` | `SourceKind` | Always `"greenhouse"` for this connector |
| `externalPostingId` | `string \| null` | Greenhouse job post ID |
| `internalJobId` | `string \| null` | Greenhouse internal job ID |
| `requisitionId` | `string \| null` | HR requisition number |
| `employerNameRaw` | `string \| null` | Raw employer name (null for Greenhouse list endpoint) |
| `employerNameNormalized` | `string \| null` | Lowercase, suffixes stripped |
| `titleRaw` | `string \| null` | Original title as fetched |
| `titleNormalized` | `string \| null` | Lowercase, punctuation stripped, entities decoded |
| `locationRaw` | `string \| null` | Original location as fetched |
| `locationNormalized` | `string \| null` | Lowercase, punctuation stripped |
| `canonicalUrl` | `string` | Canonical URL (tracking params removed, fragment removed) |
| `remoteType` | `RemoteType` | `remote` \| `hybrid` \| `onsite` \| `unknown` |
| `employmentType` | `string \| null` | Not available in Greenhouse list endpoint |
| `classification` | `OpportunityClassification` | `internship` \| `fellowship` \| `research` \| `entry_level` \| `other` |
| `department` | `string \| null` | Primary (first) department |
| `departments` | `string[]` | All departments, sorted |
| `offices` | `string[]` | All offices, sorted |
| `focusArea` | `string \| null` | Inferred from title and description |
| `postedAt` | `string \| null` | ISO YYYY-MM-DD (from `first_published`) |
| `closesAt` | `string \| null` | ISO YYYY-MM-DD (from `application_deadline`) |
| `deadlineKind` | `DeadlineKind` | `hard` \| `rolling` \| `unknown` |
| `descriptionText` | `string \| null` | Plain text from HTML content |
| `language` | `string \| null` | Language code from API |
| `relevanceScore` | `number` | 0–100 clamped |
| `relevanceScoreVersion` | `number` | Positive integer; currently 1 |
| `scoreBreakdown` | `ScoreBreakdown` | Full scoring breakdown |
| `uncertaintyFlags` | `UncertaintyFlag[]` | Fields that could not be determined |
| `fetchedAt` | `string` | ISO timestamp of the fetch operation |

Raw values are always preserved separately from normalized values. Normalization
never discards source data.

---

## Greenhouse Field Mapping

| Greenhouse API field | NormalizedSourcePosting field | Notes |
|---|---|---|
| `jobs[n].id` | `externalPostingId` | Stringified numeric ID |
| `jobs[n].internal_job_id` | `internalJobId` | Stringified, null if absent |
| `jobs[n].requisition_id` | `requisitionId` | Null if absent |
| `jobs[n].title` | `titleRaw` / `titleNormalized` | Entities decoded, HTML stripped |
| `jobs[n].location.name` | `locationRaw` / `locationNormalized` | Null if location object missing |
| `jobs[n].absolute_url` | `canonicalUrl` | Tracking params removed, fragment removed |
| `jobs[n].updated_at` | Not in material hash | Excluded (changes frequently without material change) |
| `jobs[n].content` | `descriptionText` | HTML stripped, entities decoded |
| `jobs[n].departments[].name` | `departments` | Sorted array; first element → `department` |
| `jobs[n].offices[].name` | `offices` | Sorted array |
| `jobs[n].first_published` | `postedAt` | Parsed to ISO date |
| `jobs[n].application_deadline` | `closesAt` | Parsed to ISO date or null |
| `jobs[n].language` | `language` | Preserved as-is |
| `jobs[n].metadata` | Not mapped | Deferred to Phase 2B |
| `jobs[n].content` | `descriptionText` | Also used for eligibility and remote-type inference |

`employerNameRaw` and `employerNameNormalized` are **null** for the Greenhouse
jobs-list endpoint, which does not include employer name per job. The caller
(Phase 2B worker) that knows the board's employer name should enrich these
fields before storing. The `employer_name_missing` uncertainty flag is set on
every job from this connector.

Individual job-detail requests (`GET /v1/boards/{token}/jobs/{id}`) are **not**
made in Phase 2A to avoid N+1 fetches. They are deferred to Phase 2B.

---

## Identity Key Algorithm

```
identity_key = "greenhouse:" + lowercase(boardToken) + ":" + String(jobPostId)
```

Examples:
- Board token `labgenomicsinc`, job ID `1001001` → `greenhouse:labgenomicsinc:1001001`

**Stability guarantees:**
- Does not change when title, location, content, description, or fetch time changes.
- Does not change when `updated_at` or `first_published` changes.
- Does change when the board token or job post ID changes.
- Board token is lowercased to avoid case-drift between fetches.

This maps to the `identity_key` column in `source_postings` (unique per `job_source_id`).

---

## Material Hash Field List

The material hash (`SHA-256(stableSerialize(materialFields))`) includes these
fields and **only** these fields:

| Field | Reason |
|---|---|
| `titleRaw` | Most important public-facing field |
| `locationRaw` | Officer-visible location |
| `canonicalUrl` | Direct link to the posting |
| `departments` | Sorted array of department names |
| `offices` | Sorted array of office names |
| `closesAt` | Parsed application deadline (ISO date or null) |
| `deadlineKind` | Interpretation of the deadline |

**Excluded from material hash:**
- `fetchedAt`, `first_seen_at`, `last_seen_at` — fetch metadata; changes every run
- `identityKey` — identity itself
- `relevanceScore`, `scoreBreakdown` — computed, not sourced
- `uncertaintyFlags` — computed, not sourced
- `connectorVersion` — infrastructure, not content
- `materialHash` — circular
- `internalJobId` — Greenhouse internal restructuring ID
- `language` — locale metadata
- `externalPostingId` — part of identity
- `requisitionId` — internal HR tracking; changes do not indicate public content change
- `descriptionText` (HTML content) — too volatile for a material hash; minor formatting
  updates would create spurious review tasks; deferred to Phase 2B for content-diff support
- `updated_at` — Greenhouse timestamp; changes on any server-side edit

The `stableSerialize` function sorts object keys recursively before serializing,
so the material hash is invariant to JSON key ordering differences between
fetches.

---

## Scoring Version 1

**Score range:** 0–100 (clamped)
**Score version:** 1 (increment when logic changes)
**Baseline:** 40 points before adjustments

### Positive categories

| Category | Max points | Trigger |
|---|---|---|
| `biotech_relevance` | +20 (strong), +10 (moderate) | Biotech/life-science title terms |
| `biotech_relevance` | +8 | Biotech/life-science department |
| `undergrad_access` | +15 | Explicit undergraduate eligibility language |
| `undergrad_access` | +8 | Recent-graduate language |
| `role_type` | +15 | Classification = internship |
| `role_type` | +12 | Classification = fellowship |
| `role_type` | +10 | Classification = entry_level |
| `role_type` | +8 | Classification = research |
| `geography` | +12 | Southern California location |
| `geography` | +10 | Remote |
| `geography` | +6 | Hybrid |

### Negative categories

| Category | Points | Trigger |
|---|---|---|
| `seniority` | −25 | VP, director, head of, principal, staff engineer |
| `seniority` | −15 | Senior, lead, manager |
| `degree_req` | −20 | PhD, MD, postdoc required |
| `degree_req` | −8 | Master's preferred/required |
| `undergrad_access` | −15 | "Graduate students only" |
| `unrelated_dept` | −20 | Clearly unrelated department (retail, HR, sales, etc.) |
| `eligibility` | −5 | Eligibility information missing or ambiguous |
| `link_quality` | −10 | No application URL |

All weights and term lists are centralized in `src/lib/ingestion/score.ts` and
can be revised for a future score version without changing test structure.

---

## Duplicate Assessment

The `assessDuplicate` function in `src/lib/ingestion/dedupe.ts` is a pure
function that takes a candidate and a list of existing postings and returns a
`DuplicateAssessment` with:

- `matchType` — classification from `IngestionMatchType`
- `confidence` — 0.0–1.0
- `contributingFields` — fields that triggered the match
- `conflictingFields` — fields that differ between the two postings
- `reasons` — human-readable explanation
- `requiresOfficerReview` — true when officer intervention is needed

### Match priority (highest to lowest)

| Match type | Confidence | Trigger | Officer review? |
|---|---|---|---|
| `exact_identity` | 1.0 | Same identity key | Only if content changed |
| `exact_url` | 0.95 | Same canonical URL, different identity | Always |
| `probable_same_posting` | ~0.85–0.90 | Same employer (≥85% similarity) + similar title (≥85%) | Always |
| `possible_annual_family` | 0.6 | Same employer + family title matches (≥85%), raw title similar but different | Always |
| `likely_distinct` | 0.9 | No match found | Never |
| `insufficient_information` | 0.0 | No existing postings to compare | Never |

**Annual family detection:** fires when the employer matches and the title
*family* (year/season-stripped) matches at ≥85% similarity, but the raw titles
are too different (season + year differ) to qualify as probable same posting.

---

## Uncertainty Handling

When a field cannot be reliably determined, a `UncertaintyFlag` is added to
`uncertaintyFlags` on the posting. The normalized field is set to `null` rather
than a guess.

| Flag | Cause |
|---|---|
| `employer_name_missing` | Greenhouse list endpoint does not include employer name |
| `location_missing` | `location.name` absent or null in API response |
| `location_ambiguous` | Location string is ambiguous (future use) |
| `remote_ambiguous` | No remote/onsite signal found and location is absent |
| `classification_inferred` | Classification was inferred from title/description, not explicit |
| `deadline_missing` | `application_deadline` absent or null |
| `deadline_invalid` | `application_deadline` present but not parseable as a date |
| `description_missing` | `content` absent, null, or empty |
| `employment_type_missing` | Not available in Greenhouse list endpoint |

Flags do **not** prevent the candidate from being returned; they provide context
for officer review and score adjustments.

---

## Connector Timeout and Response-Size Behavior

| Parameter | Default | Override via |
|---|---|---|
| Fetch timeout | 30 000 ms | `config.timeoutMs` |
| Max response bytes | 10 485 760 (10 MiB) | `config.maxResponseBytes` |

**Timeout:** an `AbortController` is used to cancel the request after `timeoutMs`.
When the request times out, a `ConnectorError` with `kind: "timeout"` is returned.

**Response size:** the response body is read via `ReadableStream.getReader()`.
If the accumulated byte count exceeds `maxResponseBytes`, reading is aborted and
a `ConnectorError` with `kind: "oversized"` is returned. The raw response text
is not returned for oversized responses to avoid memory pressure.

**Non-2xx responses:** the response body is drained (to release the connection)
and discarded. A typed `ConnectorError` is returned with the appropriate `kind`
and `httpStatus`.

---

## Security Boundaries

- **No authentication.** The Greenhouse jobs-list endpoint is public.
- **No application submission.** The connector only reads job listings.
- **No arbitrary URL fetching.** The board token is validated before URL construction.
  The URL is always built internally from the validated token.
- **No raw response body logging.** `rawResponseText` is stored for provenance
  but must never be logged.
- **No Supabase client.** No database writes or reads in this phase.
- **No secrets or credentials.** The connector requires no API keys.
- **No service-role client.** Deferred to Phase 2B worker.
- **Board token allowlist:** only letters, digits, hyphens, and underscores (max 128 chars).
  Tokens starting with a hyphen are rejected. Path traversal characters are rejected.
- **Fetch dependency injection:** `config.fetchFn` allows tests to use a mock
  fetch without touching the live Greenhouse API.

---

## Test Fixture Policy

Fixtures contain **invented organizations and jobs** — no real company names,
real job IDs, or copied live job descriptions.

Fixture files live in `src/__tests__/ingestion/fixtures/` and are checked into
the repository. They serve as a stable, network-free regression baseline.

| Fixture | Purpose |
|---|---|
| `greenhouse-normal.json` | 7 representative jobs (internship, entry-level, senior role, remote, hybrid, missing location, missing description/bad date) |
| `greenhouse-changed-deadline.json` | Same job 1001001, different `application_deadline` |
| `greenhouse-changed-title.json` | Same job 1001001, changed title |
| `greenhouse-same-content-different-key-order.json` | Same material fields for job 1001001 |
| `greenhouse-empty.json` | Zero jobs in response |
| `greenhouse-invalid-json.txt` | Malformed JSON (truncated) |
| `greenhouse-invalid-shape.json` | Valid JSON but missing `jobs` array |

**Fixture naming convention:** `greenhouse-{scenario}.{json|txt}`

Tests must never make live network requests. Any test that triggers a real
`fetch` to `boards-api.greenhouse.io` is a bug. The connector's `fetchFn`
parameter enables complete network isolation.

---

## Validation Commands

```bash
# Install dependencies
npm ci

# Run all tests (178 tests, no live network)
npm test

# TypeScript type checking
npm run typecheck

# Production build
npm run build

# Git whitespace check
git diff --check
```

---

## Deferred Work (Phase 2B and Later)

The following items are explicitly out of scope for Phase 2A and should be
addressed in later phases:

| Item | Phase |
|---|---|
| Supabase database writes (`source_postings`, `source_posting_versions`) | Phase 2B |
| Service-role client and Supabase credentials | Phase 2B |
| Edge Function worker that calls this connector | Phase 2B/3 |
| Supabase Cron scheduling | Phase 3 |
| Individual job-detail fetching (`GET /v1/boards/{token}/jobs/{id}`) | Phase 2B |
| Employer name enrichment from board-level metadata | Phase 2B |
| Lever, Ashby, USAJOBS, RSS, schema.org, HTML connectors | Phase 2B+ |
| Admin UI for source management (`job_sources`) | Phase 7 |
| Review task creation (`review_tasks`) | Phase 2B |
| Opportunity creation from approved candidates | Phase 2B |
| `metadata` field mapping from Greenhouse response | Phase 2B |
| Description content-diff for material hash | Phase 2B |
| Score version 2+ (recalibrated weights based on officer feedback) | Post-launch |
| Concurrent safety testing for `claim_source_fetch_runs` | Phase 2B |
| robots.txt compliance checking | Phase 2B |
| Production environment variables | Phase 2B |
| Automatic opportunity publication | Never (requires officer approval) |

---

## Design Decisions

**Why Vitest?** Minimal configuration, TypeScript-native, Node.js environment,
no Babel required. Appropriate for a small, officer-maintained student project.

**Why no employer name from Greenhouse?** The Greenhouse jobs-list endpoint
(`/v1/boards/{token}/jobs?content=true`) does not include employer name in
individual job objects. The board-level employer name is available at
`/v1/boards/{token}` (a separate request). To avoid an extra N+1-style
preambule request, the employer name is left null and flagged with
`employer_name_missing`. The calling worker in Phase 2B should resolve this
before storage.

**Why exclude `updated_at` and `content` from the material hash?**
`updated_at` changes on any Greenhouse-side edit, including minor ones that do
not affect public-facing content. Including it would cause frequent spurious
material-change events. HTML `content` changes with minor formatting tweaks and
is generally too volatile for a hash-based comparison; a diff-based approach is
deferred to Phase 2B.

**Why are `UncertaintyFlag` values deduplicated?** The same flag can be
produced by multiple independent checks. The connector deduplicates flags with
`[...new Set(flags)]` before storing to keep the array clean for officers.

**Why does `normalizeJobTitle` strip `&` from titles?** The normalization
pipeline decodes HTML entities (so `&amp;` becomes `&`) and then strips
non-word characters for comparison. This is consistent with the existing
`normalizeTitle` function in `src/lib/normalize.ts`. Raw titles (which preserve
the decoded `&`) are stored separately in `titleRaw`.

**Schema alignment:** The TypeScript types in `src/lib/ingestion/types.ts`
mirror the Phase 1 database contract in
`supabase/migrations/0003_automated_ingestion_schema.sql`. No schema
incompatibilities were found. The `source_kind` check constraint in SQL uses
`'greenhouse'` which matches `SourceKind = 'greenhouse'` in TypeScript. The
`classification` check constraint values (`internship`, `entry_level`,
`fellowship`, `research`, `other`) all match `OpportunityClassification`. The
`deadline_kind` values (`hard`, `rolling`, `unknown`) match `DeadlineKind`. The
`remote_type` values (`remote`, `hybrid`, `onsite`, `unknown`) match
`RemoteType`.
