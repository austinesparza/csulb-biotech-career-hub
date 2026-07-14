# Ingestion Persistence Bridge — Phase 2B

## Scope

Phase 2B persistence now enforces transactional posting/version integrity, compare-and-set fetch-run finalization, replay-safe payload reconciliation, and review-only behavior for non-exact opportunity matches.

## Module boundary

All modules in `src/lib/ingestion/persistence/` are server-only data-access modules and start with:

```ts
import 'server-only';
```

They are **not** Server Action modules.

## Transactional boundary

`public.upsert_source_posting_observation(...)` is the transactional boundary for critical posting mutation.

It:
- locks and validates the running fetch run
- serializes identity updates with advisory locking
- creates or updates `source_postings`
- returns deterministic `created/material_changed/reopened/stale_observation` outcomes
- rejects stale observations from regressing current posting state

Version insertion remains append-only, and duplicate version writes are blocked by unique `(source_posting_id, material_hash)`.

## Payload and version guarantees

- Success with `candidates.length > 0` requires a persisted payload row.
- `rawResponseText = null` is treated as unavailable payload and fails safe.
- `rawResponseText = ''` is valid and persisted as a zero-byte payload.
- No posting version is inserted without `source_payload_id`.

## Retry and resume rules

- `completed` and `cancelled` runs are immutable.
- `failed` runs can be resumed only with explicit `retry.resumeFailedRun = true` and only when the previous failure was persistence-related (`error_class = unexpected` + persistence marker in `log_json`).
- Connector-terminal failures are not resumed as successful runs.

## Fetch-run compare-and-set

Finalization/failure updates use:
- `id = fetchRunId`
- `status = 'running'`

Exactly one row must update; cancellation/finalization races are rejected.

## Opportunity bridge behavior

- Only `same_url` and `strict_key` matches may auto-update mutable draft opportunities.
- `family` and `fuzzy` matches are review-only: no automatic field/lifecycle mutation.
- Family/fuzzy matches create review tasks and non-primary links (`annual_family` / `probable`) when linked.
- Excluded matching population: `duplicate`, `not_relevant`, `hidden`, `archive_only`.
- `closed`, `expired`, `broken_link`, and `rejected` remain matchable as historical/repost candidates but are not silently reset.

## Company resolution

Order of operations:
1. use `job_sources.company_id` when valid
2. otherwise exact normalized company match
3. fuzzy company match creates a review task (`possible_duplicate`)
4. no match may create private company rows only when employer identity is sufficiently present
5. missing/ambiguous employer identity does not fabricate unknown companies

## Source-link semantics

- New pending opportunities created directly from source postings are linked as `match_type = exact, is_primary = true`.
- Existing opportunities receive primary exact links only when no primary link exists.
- If another primary already exists, the new exact link is inserted as non-primary.
- Duplicate and one-primary races are handled through DB constraints and recovery lookups.

## Test scope

### Schema-invariant SQL checks

`supabase/tests/ingestion_persistence_schema_invariants.sql`

### Local integration SQL checks (RPC + concurrency invariants)

`supabase/tests/ingestion_persistence_bridge.sql`

Covers:
- payload metadata insertion
- RPC posting create/replay/material-change/stale-observation outcomes
- duplicate version prevention
- review-task idempotency uniqueness
- compare-and-set run finalization race protection
- one-primary source-link enforcement

### TypeScript bridge tests

`src/__tests__/ingestion/persistence-bridge.test.ts`

Covers:
- payload-required success behavior
- empty-body payload persistence
- retry/resume rules
- stale observation non-regression
- family/fuzzy review-only behavior
- source-link primary semantics
- cancellation/finalization race handling
