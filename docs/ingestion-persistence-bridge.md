# Ingestion Persistence Bridge — Phase 2B

## Scope

Phase 2B adds a server-only persistence bridge that accepts Phase 2A connector results and writes to the Phase 1 ingestion schema without automatic publication.

Implemented flow:

connector result
→ raw payload storage
→ source payload metadata
→ source posting upsert
→ immutable posting version
→ dedupe-driven bridge assessment
→ review task creation
→ optional pending opportunity row

## Module architecture

`src/lib/ingestion/persistence/`

- `errors.ts`: typed persistence and fetch-run validation errors.
- `repository.ts`: repository interface + Supabase adapter with DI for DB and storage clients.
- `payload-storage.ts`: deterministic SHA-256 payload pathing and metadata persistence.
- `review-tasks.ts`: idempotent open-task creation for approved enum task types.
- `opportunity-bridge.ts`: pending-opportunity safety gate + approved-record protection.
- `persist-fetch-result.ts`: orchestration from fetch result to schema writes.
- `index.ts`: server-only export surface.

Dependency injection:

- `db` client (Supabase PostgREST client interface)
- `storage` client (Supabase storage interface)
- `clock` provider

## Persistence sequence

1. Load `source_fetch_runs` and validate:
   - row exists
   - `job_source_id` matches expected source
   - status is `running`
   - reject finalized statuses (`completed`, `partial`, `failed`, `cancelled`)
2. Optionally store raw payload when `rawResponseText` is available.
3. For each normalized candidate:
   - upsert `source_postings` by `(job_source_id, identity_key)`
   - preserve `first_seen_at`
   - update `last_seen_at`, `last_payload_id`, `last_material_hash`
   - reset `consecutive_misses` when seen
   - persist score + score version + uncertainty flags + score breakdown
4. Insert `source_posting_versions`:
   - first observation
   - subsequent material-hash changes only
   - deterministic `field_diff_json` from previous normalized snapshot
5. Create idempotent review tasks:
   - `source_new` for new relevant posting observations
   - `source_changed` for material changes
   - `source_reopened` when a previously closed/missing posting is seen open
6. Bridge to opportunities:
   - match existing opportunities with existing dedupe policy
   - for approved+public opportunities: update observation timestamp only; never mutate curated/public fields
   - for non-approved opportunities: update draft fields safely
   - create pending opportunities only at/above threshold, always with:
     - `status = needs_review`
     - `review_status = pending`
     - `public_safe = false`
   - create `opportunity_source_links` using allowed match types only
7. Finalize fetch run with safe structured `log_json`, counters, and final status.

## Raw payload object paths

Payload object paths are deterministic and collision-resistant:

`{job_source_id}/{source_fetch_run_id}/{sha256[0..1]}/{sha256}.txt`

This keeps stable auditability by source + run + content hash.

## Source posting and version rules

- `source_postings` are never deleted by the bridge.
- `source_posting_versions` remains append-only (existing trigger unchanged).
- A new version row is inserted only on first observation or material hash change.
- Re-observing the same material hash does not create a duplicate version row.

## Idempotency strategy (Approach B)

Phase 2B uses explicit idempotent compensation/resumability (no new RPC migration):

- payload metadata uniqueness: `(source_fetch_run_id, sha256, request_url)`
- source posting identity uniqueness: `(job_source_id, identity_key)`
- source link uniqueness: `(opportunity_id, source_posting_id)`
- open-task dedupe via deterministic task notes marker + subject/type lookup
- deterministic processing allows safe replay of the same fetch run payload

Uniqueness races are handled as retry-safe lookups where possible.

## Failure and retry behavior

- Storage upload failure aborts processing.
- Storage success + metadata failure throws `PayloadStorageMetadataError` with explicit reconciliation guidance.
- Unexpected persistence errors set fetch run status to `failed`, record safe error info in `log_json`, and rethrow.
- Raw payload text is never copied into logs.

## Approved-record mutation boundary

For matched opportunities that are already `review_status = approved` and `public_safe = true`:

- do not overwrite imported/public-facing fields
- update `last_seen_at` only
- create `source_changed` review tasks when material/flagged fields differ

## Opportunity safety gates

Pending opportunity creation requires relevance score >= 35.

Automatically created opportunities are always:

- `status = needs_review`
- `review_status = pending`
- `public_safe = false`

No bridge path sets approved/public statuses.

## Transaction limitation

Supabase JS does not provide a general client-side multi-table transaction for this workflow.

Phase 2B intentionally uses idempotent resumability (Approach B) rather than introducing transactional RPC in this phase.

## Local integration test commands

```bash
npx supabase start
npx supabase db reset --local
npx supabase db lint --local --fail-on error
npx supabase status
export LOCAL_DATABASE_URL='<local db url>'
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/automated_ingestion_schema.sql
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/ingestion_persistence_bridge.sql
```

## Deferred work

- scheduler and worker claiming loop
- additional connectors
- source admin UI
- closure/miss lifecycle automation
- transactional RPC option if future multi-table invariants require stronger atomicity
