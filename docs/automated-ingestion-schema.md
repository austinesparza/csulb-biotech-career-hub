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

**Migrations are additive and intended to run once.**  They use guards (`IF NOT EXISTS`,
`ADD VALUE IF NOT EXISTS`) only where a construct can safely be re-applied without
side effects.  Do not assume every statement is fully idempotent.

Do **not** rerun `0001_init.sql`.

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

**Mutations** (INSERT, UPDATE) are performed server-side in Phase 7 via a
server action that calls `requireOfficer()` and then uses the service-role Supabase
client.  No direct authenticated INSERT or UPDATE grant is issued.

### `source_fetch_runs`

Execution queue and run history.  Each scheduled, manual, or retry execution
creates a row with `status = 'pending'`.  Workers atomically claim rows via
`claim_source_fetch_runs()`.  Status transitions:
`pending → running → completed | failed | partial | cancelled`.

Counter columns (`records_seen`, `records_new`, etc.) are non-negative by CHECK
constraint.  `finished_at >= started_at` is enforced.  `finished_at` may only be
set when `started_at` is also set.

**`source_fetch_runs` rows cannot be freely deleted** while any
`source_posting_versions` row references them (ON DELETE RESTRICT).

### `source_payloads`

Raw provenance metadata.  Raw response bytes are stored in the private
`source-payloads` storage bucket; this row keeps the `sha256` hash and
`storage_path` for auditability.  `size_bytes >= 0` is enforced.

**`source_payloads` rows cannot be freely deleted** while any
`source_posting_versions` row references them (ON DELETE RESTRICT on the versions
FK).  Purging a fetch run cascades to payload rows only, not to version rows.

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

**`source_postings` rows cannot be freely deleted** while any version row references
them (ON DELETE RESTRICT on `source_posting_versions.source_posting_id`).

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
| `job_sources` | `priority` range | `0 <= priority <= 100` |
| `job_sources` | `consecutive_failures >= 0` | Non-negative counter |
| `job_sources` | `source_name` nonempty | `trim(source_name) <> ''` |
| `job_sources` | `careers_url` nonempty | `trim(careers_url) <> ''` |
| `job_sources` | `config_json` object | `jsonb_typeof(config_json) = 'object'` |
| `source_fetch_runs` | `source_fetch_runs_finished_requires_started` | `finished_at` may be set only when `started_at` is also set |
| `source_fetch_runs` | `source_fetch_runs_finished_after_started` | `finished_at >= started_at` when both are set |
| `source_fetch_runs` | `http_status` range | `100 <= http_status <= 599` when present |
| `source_fetch_runs` | Counter checks | `records_seen`, `records_new`, `records_changed`, `records_unchanged`, `records_reviewed`, `records_closed_candidates`, `payload_count` all `>= 0` |
| `source_fetch_runs` | `error_class` check | Must be in `('network','timeout','robots','auth','schema','rate_limit','unexpected')` or NULL |
| `source_payloads` | `sha256` format | Exactly 64 lowercase hexadecimal characters |
| `source_payloads` | `storage_path` nonempty | `trim(storage_path) <> ''` |
| `source_payloads` | `request_url` nonempty | `trim(request_url) <> ''` |
| `source_payloads` | `status_code` range | `100 <= status_code <= 599` when present |
| `source_payloads` | `size_bytes >= 0` | Non-negative |
| `source_postings` | `canonical_url` nonempty | `trim(canonical_url) <> ''` |
| `source_postings` | `identity_key` nonempty | `trim(identity_key) <> ''` |
| `source_postings` | `last_material_hash` format | Exactly 64 lowercase hexadecimal characters |
| `source_postings` | `source_postings_seen_window_valid` | `last_seen_at >= first_seen_at` |
| `source_postings` | `source_postings_closes_after_posted` | `closes_at >= posted_at` when both are set |
| `source_postings` | `closure_confidence` range | `0 <= closure_confidence <= 1` |
| `source_postings` | `consecutive_misses >= 0` | Non-negative |
| `source_postings` | `relevance_score_version` | `> 0` when non-null |
| `source_posting_versions` | `connector_version` nonempty | `trim(connector_version) <> ''` |
| `source_posting_versions` | `material_hash` format | Exactly 64 lowercase hexadecimal characters |
| `opportunity_source_links` | `match_type` check | Must be in `('exact','probable','manual','annual_family','alternate_source')` |
| `opportunity_source_links` | Unique on `(opportunity_id, source_posting_id)` | No duplicate links |
| `opportunity_source_links` | Partial unique on `(opportunity_id) WHERE is_primary` | At most one primary link per opportunity |

---

## FK deletion behavior

| FK | `ON DELETE` | Rationale |
|---|---|---|
| `job_sources.source_record_id → source_records` | `RESTRICT` | Cannot delete a source record while a job source references it |
| `job_sources.company_id → companies` | `SET NULL` | Company deletion nulls the reference; source survives |
| `source_fetch_runs.job_source_id → job_sources` | `RESTRICT` | Preserves run history when a source is disabled |
| `source_payloads.source_fetch_run_id → source_fetch_runs` | `CASCADE` | Purging a run purges its payload metadata rows |
| `source_postings.job_source_id → job_sources` | `RESTRICT` | Preserves posting history when a source is disabled |
| `source_postings.last_payload_id → source_payloads` | `SET NULL` | Payload purge does not cascade to the posting row |
| `source_posting_versions.source_posting_id → source_postings` | `RESTRICT` | Cannot delete a posting while version rows reference it; postings are closed, not deleted |
| `source_posting_versions.source_fetch_run_id → source_fetch_runs` | `RESTRICT` | Cannot delete a run while version rows reference it |
| `source_posting_versions.source_payload_id → source_payloads` | `RESTRICT` | Cannot delete a payload while version rows reference it |
| `opportunity_source_links.opportunity_id → opportunities` | `RESTRICT` | Cannot delete an opportunity with active source links |
| `opportunity_source_links.source_posting_id → source_postings` | `RESTRICT` | Cannot delete a posting with active links |

**Practical implication**: once `source_posting_versions` rows exist for a run or
posting, neither the run nor the posting can be deleted.  In normal operation
neither should be — runs are the audit trail and postings are marked `closed`
rather than deleted.

---

## RLS and grants

### Principle

`anon` has no access to any of the six ingestion tables.  `authenticated` officers
have SELECT access only.  All mutations to ingestion tables are performed by
`service_role` workers or (for `job_sources` in Phase 7) by server-side actions
that call `requireOfficer()` and then use the service-role Supabase client.
`service_role` bypasses RLS entirely.

### Grant summary

| Role | `job_sources` | `source_fetch_runs` | `source_payloads` | `source_postings` | `source_posting_versions` | `opportunity_source_links` |
|---|---|---|---|---|---|---|
| `anon` | — | — | — | — | — | — |
| `authenticated` (non-officer) | blocked by RLS | blocked by RLS | blocked by RLS | blocked by RLS | blocked by RLS | blocked by RLS |
| `authenticated` (officer) | SELECT | SELECT | SELECT | SELECT | SELECT | SELECT |
| `service_role` | ALL | ALL | ALL | ALL | ALL | ALL |

Note: `service_role` bypasses RLS.  The grants to `service_role` are explicit table
grants but do not depend on RLS policies.

### Why authenticated has no INSERT or UPDATE

Phase 7 source-management actions will:
- run server-side in a Next.js Server Action
- call `requireOfficer()` to verify the session
- create the service-role Supabase client only after authorization
- perform all `job_sources` mutations through that server-only path

Granting INSERT or UPDATE directly to `authenticated` would bypass this server-side
authorization boundary.

### Why officers cannot DELETE `job_sources`

Deletion is not granted.  Sources should be disabled (`enabled = false`) or paused
(`automatic_scheduling_paused_at = now()`).  This preserves run history and prevents
accidental data loss.

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
  SECURITY INVOKER
  search_path = pg_catalog, pg_temp
```

**Purpose**: atomically lease up to `p_limit` pending `source_fetch_runs` rows for
a named worker, preventing duplicate claims by concurrent callers.

**Parameters**:

| Parameter | Type | Valid range | Notes |
|---|---|---|---|
| `p_worker_id` | `text` | nonempty | Identifies the calling worker instance; stored in `worker_id` column |
| `p_limit` | `integer` | 1–50 inclusive | `null` is rejected; values outside `[1, 50]` are rejected; values are **not** clamped |

**Behavior**:
- Raises an exception if `p_worker_id` is NULL or blank.
- Raises an exception if `p_limit` is NULL.
- Raises an exception if `p_limit` is outside the range 1–50 inclusive.
- Selects pending rows where `scheduled_for <= now()`, `job_source.enabled = true`,
  and `automatic_scheduling_paused_at IS NULL`, ordered by `(priority ASC, scheduled_for ASC, created_at ASC)`.
- Uses `FOR UPDATE … SKIP LOCKED` to prevent two concurrent callers from claiming
  the same row.
- Atomically sets `status = 'running'`, `started_at = now()`, and `worker_id` in a
  single `UPDATE … FROM … RETURNING` statement.
- Returns the claimed rows.

**SECURITY INVOKER**: the function runs as the calling role.  Only `service_role`
has EXECUTE permission.  All table references are schema-qualified; the `search_path`
is set to `pg_catalog, pg_temp` to prevent injection.

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
- **Posting-level deletes are blocked**: `ON DELETE RESTRICT` on
  `source_posting_versions.source_posting_id` means a posting cannot be deleted
  while version rows reference it.  In normal operation, postings are marked
  `current_status = 'closed'`, not deleted.

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

> **WARNING**: do NOT run `supabase db push` for local verification.  That command
> targets the linked remote project and will modify production data.

```bash
# 1. Install dependencies
npm ci

# 2. TypeScript type checking
npm run typecheck

# 3. Production build
npm run build

# 4. Start local Supabase stack (requires Supabase CLI)
npx supabase start

# 5. Reset local database and apply all migrations
npx supabase db reset --local

# 6. Lint the schema (catches common issues)
npx supabase db lint --local

# 7. Run the verification script against the local database
psql '******127.0.0.1:54322/postgres' \
  -f supabase/tests/automated_ingestion_schema.sql
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
| Officer `authenticated` can SELECT ingestion tables | Requires officer `auth.users` row and `SET ROLE authenticated` |
| `source-payloads` bucket is private | Requires local Supabase with storage schema |
| True concurrent-worker duplicate-claim prevention | Requires two simultaneous database sessions |
| Trigger fires for `service_role` | Requires a service-role session |

---

## Rollback strategy

**Production**: use a forward-fix strategy.  Do not drop tables that contain audit data.

1. Disable all `job_sources` by setting `enabled = false`.
2. Set `automatic_scheduling_paused_at = now()` on all sources to halt scheduling.
3. Revert any application code that references the new tables if necessary.
4. Preserve all existing rows in `source_fetch_runs`, `source_payloads`,
   `source_postings`, `source_posting_versions`, and `opportunity_source_links`
   for auditability.

**Local disposable databases**: `npx supabase db reset --local` drops and rebuilds the
entire local database, which is safe and sufficient for development.

Do **not** manually delete rows from `supabase_migrations.schema_migrations`.
