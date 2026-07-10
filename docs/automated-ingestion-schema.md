# Automated Ingestion Schema — Phase 1

This document describes the database schema introduced by migrations
`0002_ingestion_task_types.sql`, `0003_automated_ingestion_schema.sql`, and
`0004_source_payload_bucket.sql`.

---

## Migration sequence

| File | Contains | Must run after |
|---|---|---|
| `0001_init.sql` | Base schema (existing) | — |
| `0002_ingestion_task_types.sql` | Four `task_type` enum additions | `0001` |
| `0003_automated_ingestion_schema.sql` | Six ingestion tables, indexes, triggers, RLS, grants, queue function | `0002` |
| `0004_source_payload_bucket.sql` | Private `source-payloads` storage bucket | `0003` (logical; no SQL dependency) |

`0002` must be committed (not just applied in the same transaction) before `0003`
references the new enum values.  `ALTER TYPE … ADD VALUE` cannot be used within a
transaction whose subsequent statements reference the newly added value.

Do **not** rerun `0001_init.sql`.  All Phase 1 additions are additive and idempotent
(`CREATE TABLE IF NOT EXISTS`, guarded `DO $$ … $$` blocks, `ON CONFLICT DO UPDATE`).

---

## Table purposes

### `job_sources`

Machine-readable approved source registry.  Each row is anchored to an existing
`source_records` row (unique FK) so all Phase 1 objects share the existing provenance
model.  Officers register and configure sources here (name, kind, URL, fetch
interval, connector config, policy review fields).

A source may only be `enabled = true` once:
- `terms_reviewed = true`
- `terms_review_date` is set
- `robots_reviewed = true`
- `automatic_scheduling_paused_at IS NULL`

Officers disable sources by setting `enabled = false` or
`automatic_scheduling_paused_at = now()`.  Deletion is not granted.

### `source_fetch_runs`

Execution queue and run history.  Each scheduled, manual, or retry execution
creates a row with `status = 'pending'`.  Workers atomically claim rows via
`claim_source_fetch_runs()`.  Status transitions:
`pending → running → completed | failed | partial | cancelled`.

Counter columns (`records_seen`, `records_new`, etc.) are non-negative by CHECK
constraint.  `finished_at >= started_at` is enforced.

### `source_payloads`

Raw provenance metadata.  Raw response bytes are stored in the private
`source-payloads` storage bucket; this row keeps the `sha256` hash and
`storage_path` for auditability.  `size_bytes >= 0` is enforced.

`source_payloads` cascades on `source_fetch_run` delete, allowing purge of an
entire run without orphaned rows.

### `source_postings`

One row per source-specific posting identity, with current normalized state.
`identity_key` is a deterministic connector-built composite unique per
`(job_source_id, identity_key)` (enforced by unique index).  Tracks
`current_status`, `relevance_score`, `closure_confidence`, `consecutive_misses`,
and the pointer to the most recent payload.

### `source_posting_versions`

Immutable normalized snapshot history.  The worker inserts one row per material
change or initial observation.  **UPDATE and DELETE are permanently blocked** by a
before-trigger (`trg_source_posting_versions_append_only`) that fires for every
session role — including `service_role`.  This is a database-level invariant, not
an application convention.

### `opportunity_source_links`

Maps curated `opportunities` rows to machine-observed `source_postings`.  Supports
M:N (one opportunity can be linked to multiple sources, one posting can match
multiple opportunities).  A partial unique index enforces at most one `is_primary`
link per opportunity.

---

## Important constraints

| Table | Constraint | Rule |
|---|---|---|
| `job_sources` | `job_sources_enablement_requires_policy_review` | `enabled` may only be `true` when `terms_reviewed`, `robots_reviewed`, `terms_review_date IS NOT NULL`, and `automatic_scheduling_paused_at IS NULL` |
| `job_sources` | `job_sources_terms_date_requires_terms_review` | `terms_review_date` may only be set when `terms_reviewed = true` |
| `job_sources` | `consecutive_failures >= 0` | Non-negative counter |
| `source_fetch_runs` | `source_fetch_runs_finished_after_started` | `finished_at >= started_at` when both are set |
| `source_fetch_runs` | Counter checks | `records_seen`, `records_new`, `records_changed`, `records_unchanged`, `records_reviewed`, `records_closed_candidates`, `payload_count` all `>= 0` |
| `source_fetch_runs` | `error_class` check | Must be in `('network','timeout','robots','auth','schema','rate_limit','unexpected')` or NULL |
| `source_payloads` | `size_bytes >= 0` | Non-negative |
| `source_postings` | `source_postings_seen_window_valid` | `last_seen_at >= first_seen_at` |
| `source_postings` | `source_postings_closes_after_posted` | `closes_at >= posted_at` when both are set |
| `source_postings` | `closure_confidence` range | `0 <= closure_confidence <= 1` |
| `source_postings` | `consecutive_misses >= 0` | Non-negative |
| `opportunity_source_links` | Unique on `(opportunity_id, source_posting_id)` | No duplicate links |
| `opportunity_source_links` | Partial unique on `(opportunity_id) WHERE is_primary` | At most one primary link per opportunity |

---

## FK deletion behavior

| FK | `ON DELETE` | Rationale |
|---|---|---|
| `job_sources.source_record_id → source_records` | `RESTRICT` | Cannot delete a source record while a job source references it |
| `job_sources.company_id → companies` | `SET NULL` | Company deletion nulls the reference; source survives |
| `source_fetch_runs.job_source_id → job_sources` | `RESTRICT` | Preserves run history when a source is disabled |
| `source_payloads.source_fetch_run_id → source_fetch_runs` | `CASCADE` | Purging a run purges its payload metadata |
| `source_postings.job_source_id → job_sources` | `RESTRICT` | Preserves posting history when a source is disabled |
| `source_postings.last_payload_id → source_payloads` | `SET NULL` | Payload purge does not cascade to the posting row |
| `source_posting_versions.source_posting_id → source_postings` | `CASCADE` | Removing a posting removes its version history |
| `source_posting_versions.source_fetch_run_id → source_fetch_runs` | `RESTRICT` | Cannot delete a run while version rows reference it |
| `source_posting_versions.source_payload_id → source_payloads` | `RESTRICT` | Cannot delete a payload while version rows reference it |
| `opportunity_source_links.opportunity_id → opportunities` | `RESTRICT` | Cannot delete an opportunity with active source links |
| `opportunity_source_links.source_posting_id → source_postings` | `RESTRICT` | Cannot delete a posting with active links |

---

## RLS and grants

### Principle

`anon` has no access to any of the six ingestion tables.  `authenticated` officers
have the minimum access needed for the Phase 1 source management workflow.
`service_role` bypasses RLS entirely and is the only principal that writes to
`source_fetch_runs`, `source_payloads`, `source_postings`, `source_posting_versions`,
and `opportunity_source_links`.

### Grant summary

| Role | `job_sources` | `source_fetch_runs` | `source_payloads` | `source_postings` | `source_posting_versions` | `opportunity_source_links` |
|---|---|---|---|---|---|---|
| `anon` | — | — | — | — | — | — |
| `authenticated` (non-officer) | blocked by RLS | blocked by RLS | blocked by RLS | blocked by RLS | blocked by RLS | blocked by RLS |
| `authenticated` (officer) | SELECT, INSERT, UPDATE | SELECT | SELECT | SELECT | SELECT | SELECT |
| `service_role` | ALL | ALL | ALL | ALL | ALL | ALL |

Note: `service_role` bypasses RLS.  The grants to `service_role` are explicit table
grants but do not depend on RLS policies.

### Why officers cannot DELETE `job_sources`

Deletion is not granted.  Sources should be disabled (`enabled = false`) or paused
(`automatic_scheduling_paused_at = now()`).  This preserves run history and prevents
accidental data loss.

### Why officers cannot mutate fetch runs, payloads, postings, versions, or links

These tables are exclusively written by service-role workers.  Officer-initiated
mutations could corrupt the audit trail and break the provenance model.

---

## Service-role boundary

`service_role` bypasses RLS on all tables.  **It does not bypass triggers.**  The
append-only trigger on `source_posting_versions` fires for `service_role` operations
as well as officer operations.

Workers using the Supabase service-role key:
- call `claim_source_fetch_runs()` to lease `source_fetch_runs` rows
- insert `source_payloads`, `source_postings`, `source_posting_versions`, `opportunity_source_links`
- update `source_postings` (current state)
- update `source_fetch_runs` (progress counters, final status)

The admin interface (Phase 7) will interact with `job_sources` via server-side
actions that call `requireOfficer()` and then use the service-role Supabase client.

---

## `claim_source_fetch_runs` function

```
public.claim_source_fetch_runs(p_worker_id text, p_limit integer default 1)
  RETURNS SETOF public.source_fetch_runs
  LANGUAGE plpgsql
  SECURITY DEFINER
  search_path = public, pg_temp
```

**Purpose**: atomically lease up to `p_limit` pending `source_fetch_runs` rows for
a named worker, preventing duplicate claims by concurrent callers.

**Parameters**:

| Parameter | Type | Valid range | Notes |
|---|---|---|---|
| `p_worker_id` | `text` | nonempty | Identifies the calling worker instance; stored in `worker_id` column |
| `p_limit` | `integer` | 1–50 | Values outside range are clamped; NULL defaults to 1 |

**Behavior**:
- Raises an exception if `p_worker_id` is NULL or blank.
- Clamps `p_limit` to `[1, 50]`.
- Selects pending rows where `scheduled_for <= now()`, `job_source.enabled = true`,
  and `automatic_scheduling_paused_at IS NULL`, ordered by `(priority ASC, scheduled_for ASC, created_at ASC)`.
- Uses `FOR UPDATE … SKIP LOCKED` to prevent two concurrent callers from claiming
  the same row.
- Atomically sets `status = 'running'`, `started_at = now()`, and `worker_id` in a
  single `UPDATE … FROM … RETURNING` statement.
- Returns the claimed rows.

**SECURITY DEFINER**: used so the function runs as its owner (postgres) regardless
of the caller's effective privileges.  Combined with the `search_path` fix this
prevents search-path injection.  `EXECUTE` is revoked from `public`, `anon`, and
`authenticated`; only `service_role` may call this function.

**Concurrency safety**: `FOR UPDATE … SKIP LOCKED` ensures each pending row is
leased at most once across concurrent callers within the same database.

---

## Immutable version behavior (`source_posting_versions`)

The trigger `trg_source_posting_versions_append_only` is a `BEFORE UPDATE OR DELETE`
trigger on `source_posting_versions`.  It unconditionally raises an exception for any
attempted update or deletion.

- **Applies to all roles including `service_role`**: triggers fire at the database
  level regardless of RLS bypass.  `service_role` cannot update or delete version
  rows.
- **Cascade from parent still works**: `ON DELETE CASCADE` from `source_postings`
  issues a `DELETE` statement internally; this **will** be blocked by the trigger.
  To purge a posting and its versions, the trigger must be temporarily disabled by a
  superuser.  In normal operation, postings are not deleted — they are marked
  `current_status = 'closed'`.

---

## Private bucket behavior (`source-payloads`)

The `source-payloads` Supabase Storage bucket is created with `public = false` and
a 50 MiB per-object file size limit.

- **No access for anon or authenticated**: no storage object policies are created in
  Phase 1.
- **Service-role access**: `service_role` bypasses Supabase Storage RLS and can
  upload and download objects without object-level policies.
- **Future admin access**: Phase 7 will add a server-side action protected by
  `requireOfficer()` that uses the service-role Supabase client to download
  payload objects for diff inspection.  Direct browser object access for officers
  is intentionally deferred.

---

## Local verification commands

```bash
# 1. Install dependencies
npm ci

# 2. TypeScript type checking
npm run typecheck

# 3. Production build
npm run build

# 4. Start local Supabase (requires Supabase CLI)
supabase start

# 5. Apply all migrations
supabase db push

# 6. Run the verification script
psql "$DATABASE_URL" -f supabase/tests/automated_ingestion_schema.sql

# DATABASE_URL is printed by `supabase start`; typically:
# ******127.0.0.1:54322/postgres
```

---

## Tests not executed and why

A local Supabase instance is not running in the sandboxed CI environment used to
produce this branch.  The verification script was authored and reviewed but not
executed against a live database.

The following checks in `supabase/tests/automated_ingestion_schema.sql` were **not**
run:

| Section | Reason |
|---|---|
| All schema checks (tables, enum values, constraints, indexes, triggers, policies) | No local Supabase database available |
| `anon` cannot read ingestion tables | Requires `SET ROLE anon`; needs superuser privilege |
| Non-officer `authenticated` cannot read ingestion tables | Requires `SET ROLE authenticated` and a non-officer `auth.users` row |
| Officer `authenticated` can SELECT, INSERT, UPDATE `job_sources` | Requires officer `auth.users` row and `SET ROLE authenticated` |
| Officer cannot mutate `source_fetch_runs` etc. | As above |
| `source-payloads` bucket is private | Requires live Supabase project |
| True concurrent-worker duplicate-claim prevention | Requires two simultaneous database sessions |
| Trigger fires for `service_role` | Requires a service-role session |

---

## Rollback strategy

Phase 1 migrations are additive and do not alter any column, index, or policy from
`0001_init.sql`.  To roll back:

1. Drop the six new tables (cascade will remove indexes and triggers automatically):
   ```sql
   drop table if exists public.opportunity_source_links cascade;
   drop table if exists public.source_posting_versions cascade;
   drop table if exists public.source_postings cascade;
   drop table if exists public.source_payloads cascade;
   drop table if exists public.source_fetch_runs cascade;
   drop table if exists public.job_sources cascade;
   ```

2. Drop the helper function:
   ```sql
   drop function if exists public.claim_source_fetch_runs(text, integer);
   drop function if exists public.prevent_source_posting_versions_mutation();
   ```

3. Remove the enum values (Postgres does not support `ALTER TYPE … DROP VALUE`
   directly in older versions).  If the values are unused, create a new enum without
   them and migrate the column.  In practice, simply leaving the unused enum values in
   `task_type` is safe because they are additive and do not affect the existing
   `review_tasks` table.

4. Delete the storage bucket in Supabase Dashboard → Storage, or via:
   ```sql
   delete from storage.buckets where id = 'source-payloads';
   ```

5. Drop migration tracking rows if using Supabase's migration history table:
   ```sql
   delete from supabase_migrations.schema_migrations
   where version in ('20240001000002','20240001000003','20240001000004');
   ```
   (Exact version strings depend on the Supabase CLI format used during `db push`.)
