# Automated Ingestion Audit — Phase 0

**Branch:** `feat/automated-opportunity-ingestion`  
**Audited by:** Copilot Coding Agent  
**Date:** 2026-07-10  
**Reference specification:** `docs/automated-opportunity-research.md`

---

## Command Results

### `npm ci`

```
added 58 packages, and audited 59 packages in 9s
12 packages are looking for funding
2 moderate severity vulnerabilities
npm warn allow-scripts: sharp@0.34.5 has install scripts not yet covered by allowScripts
Exit code: 0
```

Two moderate vulnerabilities exist in the dependency tree (pre-existing; unrelated to this phase). The `sharp` package warning is a transient install-script advisory, also pre-existing.

### `npm run test`

No `test` script is defined in `package.json`. Command does not exist. No test runner is installed.

### `npm run typecheck`

```
> csulb-biotech-career-hub@0.1.0 typecheck
> tsc --noEmit

Exit code: 0 — no type errors
```

### `npm run build`

```
> csulb-biotech-career-hub@0.1.0 build
> next build

⚠ Compiled with warnings in 1756ms
  ./node_modules/@supabase/supabase-js/dist/index.mjs
  A Node.js API is used (process.version at line: 27) which is not supported in
  the Edge Runtime. (pre-existing upstream warning from @supabase/ssr)

✓ Compiled successfully in 8.8s
✓ Generating static pages (7/7)

Routes built:
  ƒ /              ƒ /admin          ƒ /admin/add
  ƒ /admin/duplicates               ƒ /admin/import
  ○ /admin/login   ƒ /admin/review   ○ /about
  ƒ /api/export    ƒ /companies      ƒ /internships
  ○ /submit

ƒ Middleware: 90.1 kB
Exit code: 0 — build succeeds
```

The Edge Runtime warning is upstream from `@supabase/ssr`; it is a known false positive because the Supabase client is only instantiated in server components and actions, not in middleware proper. The build gate is clean.

---

## 1. Existing Reusable Database Tables, Views, Functions, and Workflows

### Tables (all in `supabase/migrations/0001_init.sql`)

| Table | Purpose | Reuse classification |
|---|---|---|
| `officers` | Auth allowlist; `user_id` references `auth.users` | **Keep as-is** |
| `source_records` | Human-readable provenance record; `source_type` enum includes `website_page`; has `url`, `refresh_policy`, `last_imported_at` | **Extend** — each automated source should have a corresponding `source_records` row; the spec's new `job_sources` table must reference it |
| `companies` | Curated company registry; `name_normalized` unique; `public_safe` gate | **Keep as-is** |
| `opportunities` | Core publication table; `status`, `review_status`, `public_safe` triple gate; `dedupe_key` + `family_key`; `relevance_score` + `relevance_reasons`; `last_seen_at` for import-immutability | **Keep as-is**; the automated layer routes into this table through the existing review workflow |
| `import_runs` | Per-import audit trail: filename, who, when, source, counts | **Keep as-is**; automated fetches produce a parallel `source_fetch_runs` rather than overloading this table |
| `raw_import_rows` | Verbatim per-row JSON; permanent audit trail | **Keep as-is** for CSV path; automated path uses `source_payloads` / `source_postings` instead |
| `review_tasks` | Task queue for officer follow-up; existing `task_type` enum includes `import_changed`, `possible_duplicate`, `possible_repost` | **Extend** — new automated task types (`source_changed`, `stale_record`, `reopen_candidate`) need to be added to the `task_type` enum |
| `user_submissions` | Public-form submissions; anon insert only | **Keep as-is** |
| `people`, `mentorship_profiles`, `events`, `career_paths`, `resources`, `semester_reports` | M2/M3/M4 tables | **Keep as-is**; not touched by automation |

### Views

| View | Columns exposed | Gate | Reuse |
|---|---|---|---|
| `public_opportunities` | id, company_name, title, posting_url, location, eligibility, focus_area, deadline, deadline_text, start_date_text, paid_status, application_type, status, public_notes, relevance_score, last_checked_at, first_seen_at, source_name | `public_safe AND review_status='approved' AND status IN ('open_verified','open_unverified')` | **Unchanged** — automated discoveries never appear here until officer approval |
| `public_companies` | id, name, website, location, industry_tags, description, open_count | `public_safe` | **Unchanged** |
| `public_mentors`, `public_alumni`, `public_events`, `public_resources`, `public_career_paths` | Respective safe columns | `public_safe AND consent*` | **Unchanged** |

### SQL Functions

| Function | Definition | Reuse |
|---|---|---|
| `is_officer()` | `select exists (select 1 from officers where user_id = auth.uid() and is_active)` | **Reused directly** in all new RLS policies |
| `set_updated_at()` | Trigger function for `updated_at` | **Reused** for all new tables that have `updated_at` |

### Existing Workflows (application code)

| Path | File(s) | Purpose | Reuse |
|---|---|---|---|
| CSV import pipeline | `src/app/admin/import/actions.ts`, `src/lib/csvImport.ts` | Header mapping, raw row storage, dedupe, scoring, `needs_review` insert | **Keep as-is**; automated path uses the same `decideUpdatePolicy` and `changedFlaggedFields` logic |
| Officer review queue | `src/app/admin/review/page.tsx`, `actions.ts`, `review-list.tsx` | Loads `needs_review`, approve/reject/duplicate, guards public publication | **Keep as-is**; automated-ingestion review tasks land in the same queue |
| Deduplication | `src/lib/dedupe.ts` | Dice bigram similarity, URL/strict-key/family/fuzzy matching, `decideUpdatePolicy`, `changedFlaggedFields` | **Reused** — new connector bridge calls the same functions |
| Relevance scoring | `src/lib/relevance.ts` | `scoreOpportunity()`, `DEFAULT_CONFIG`, transparent `reasons` | **Reused** — extended with new positive/negative signals for automated sources (spec §10) |
| Normalization | `src/lib/normalize.ts` | `normalizeCompanyName`, `normalizeTitle`, `normalizeTitleFamily`, `normalizeUrl`, `parseDeadline`, `parsePaidStatus`, `cleanText`, `sanitizeSearchTerm` | **Reused** — new `src/lib/connectors/normalize/` utilities extend these |
| Server clients | `src/lib/supabase/server.ts` | `createServerAuthClient()`, `createServiceClient()`, `requireOfficer()` | **Keep as-is** |
| Middleware | `src/middleware.ts` | Session gate for `/admin/*`; redirects unsigned-in users to login | **Unchanged** |
| Public board | `src/app/internships/page.tsx`, `board.tsx` | Reads only `public_opportunities` with sanitized filters | **Unchanged** |
| Company directory | `src/app/companies/page.tsx` | Reads only `public_companies` | **Unchanged** |
| Export endpoint | `src/app/api/export/route.ts` | Officer-authed CSV/JSON export | **Unchanged** |
| Student submission form | `src/app/submit/page.tsx` | Public opportunity/correction/resource/mentor-update form with honeypot | **Unchanged** |
| Quick-add | `src/app/admin/add/` | Paste-to-prefill form for manual officer entry; dedupe fires | **Unchanged** |
| Duplicate review | `src/app/admin/duplicates/` | Officer side-by-side duplicate comparison | **Unchanged** |

### CI Workflow

`.github/workflows/ci.yml` runs two jobs on every push/PR:

1. `typecheck` — `npm install && npm run typecheck`
2. `build` — `npm install && npm run build` with dummy Supabase env vars

The build job explicitly uses placeholder values so CI is not coupled to a live Supabase project. **This approach should be preserved for all new code.** The spec (§14) says the CI should also add unit tests and migration smoke coverage before merge; that is a future concern for later phases.

---

## 2. Officer Authentication and Authorization Boundaries

### Session gate (first door)

`src/middleware.ts` intercepts all `/admin/*` requests. It creates a cookie-based `@supabase/ssr` client using the **anon key** and calls `supabase.auth.getUser()`. If no valid session exists, the user is redirected to `/admin/login`. The login page itself (`/admin/login`) is explicitly excluded from the redirect.

This gate checks that a **Supabase session exists** but does **not** check `officers` table membership. It is intentionally lightweight.

### Action gate (second door)

Every admin server action calls `await requireOfficer()` before any privileged operation. `requireOfficer()` in `src/lib/supabase/server.ts`:

1. Creates a cookie-based client (anon key).
2. Calls `supabase.auth.getUser()` to get the authenticated user.
3. Queries the `officers` table: `select user_id, display_name ... where user_id = user.id AND is_active = true`.
4. Throws `'Not an active officer'` if the row is absent or `is_active` is false.
5. Returns `{ user, officer }` only on success.

The service client is **never created before this guard returns successfully.**

### RLS (third door)

All base tables have RLS enabled with a single policy: `create policy officer_all_<table> on <table> for all using (is_officer()) with check (is_officer())`. The anon role has no grants on base tables; it can only `SELECT` from the seven `public_*` views and `INSERT` into `user_submissions`.

### Summary of authorization layers

```
HTTP request to /admin/*
  → middleware (session present?)      [cookie-based anon-key client]
    → server action / page component
      → requireOfficer()               [cookie-based anon-key + officers table check]
        → createServiceClient()        [service-role key, bypasses RLS]
          → Supabase Postgres
            → RLS (is_officer())       [database enforces independently]
```

Every layer is redundant by design. Removing any one layer does not expose a route to unauthorized writes.

**For automated scheduled jobs:** scheduled Edge Functions do not go through the HTTP middleware or `requireOfficer()`. They must authenticate through the service-role key directly and must not expose this key in any client path. The spec (§12) is explicit: scheduled ingestion must run server-only; preview deployments must not receive the production service-role key.

---

## 3. Where and How the Supabase Service-Role Client Is Created

**File:** `src/lib/supabase/server.ts`, function `createServiceClient()`:

```typescript
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

- Uses `SUPABASE_SERVICE_ROLE_KEY` — a server-only env var (never `NEXT_PUBLIC_`).
- `persistSession: false` prevents any accidental session storage.
- The key bypasses all RLS policies.

**Calling sites (verified):**

| File | Guard before call |
|---|---|
| `src/app/admin/import/actions.ts` | `await requireOfficer()` on line 43, `createServiceClient()` on line 44 |
| `src/app/admin/review/actions.ts` | `await requireOfficer()` before every action; service client used immediately after |
| `src/app/admin/review/page.tsx` | `await requireOfficer()` on line 10, service client on line 11 |
| `src/app/admin/add/actions.ts` | (verified present via directory listing; same pattern) |

No browser-side file imports `server.ts`. The Next.js App Router keeps server-only files isolated by convention and the `'use server'` directive.

**Automated ingestion risk:** Edge Functions or Supabase Cron jobs will use the same service-role key but outside the Next.js server-action framework. They must enforce equivalent officer-less authorization (no interactive user) through a separate server-secret pattern and must never expose the key to preview deployments unless those previews point to an isolated staging Supabase project.

---

## 4. Existing Review, Approval, Rejection, and Publication Behavior

### Approval (`approveOpportunity`)

Defined in `src/app/admin/review/actions.ts`:

1. Calls `requireOfficer()`.
2. Validates `status` is one of `['open_verified', 'open_unverified']`.
3. Fetches the opportunity to confirm it exists.
4. Updates: `status`, `review_status = 'approved'`, `public_safe = true`, `public_notes` (trimmed officer input or `null`), `last_checked_at` (only when `open_verified`).
5. Optionally sets `companies.public_safe = true`.
6. Calls `revalidatePath` on `/`, `/internships`, `/companies`, `/admin/review`.

Approval is **not reversible** without a separate hide/reject action. `public_notes` is set exclusively from officer input at approval time; it cannot receive imported text silently.

### Rejection (`rejectOpportunity`)

Sets `status = 'not_relevant' | 'hidden'`, `review_status = 'rejected'`, `public_safe = false`. Requires officer auth.

### Duplicate marking (`markDuplicate`)

Sets `status = 'duplicate'`, `duplicate_of = <id>`, `public_safe = false`. No automatic deletion.

### Publication gate

Records appear in `public_opportunities` only when **all three conditions** are true simultaneously:
- `opportunities.public_safe = true`
- `opportunities.review_status = 'approved'`
- `opportunities.status IN ('open_verified', 'open_unverified')`

No automated path currently sets any of these flags. Import always sets `status = 'needs_review'`, `review_status = 'pending'`, `public_safe = false`. This invariant must be preserved for automated ingestion.

---

## 5. Existing Deduplication and Relevance-Scoring Behavior

### Deduplication (`src/lib/dedupe.ts`)

**Company matching** — priority order:
1. Exact `name_normalized` match → reuse silently.
2. Dice bigram similarity ≥ 0.85 → reuse but open `possible_duplicate` review task.
3. No match → create new company.

`COMPANY_FUZZY_THRESHOLD = 0.85`, `OPPORTUNITY_FUZZY_THRESHOLD = 0.80`.

**Opportunity matching** — priority order:
1. Same `posting_url` (`same_url`) — strongest identity signal.
2. Same `dedupe_key` (`strict_key`) — `company|full normalized title|url`.
3. Same `family_key` (`family`) — `company|season/year-stripped title`; flags only, never auto-updates.
4. Dice similarity ≥ 0.80 on title, same company only (`fuzzy`) — flags only.

**Update policy (`decideUpdatePolicy`):**
- `review_status != 'approved' OR public_safe != true` → `update_fields` (refresh imported fields + score).
- `review_status = 'approved' AND public_safe = true` → `touch_and_flag` (update `last_seen_at` only; if any flagged field changed, open `import_changed` task).

**Flagged fields that trigger `import_changed`:** `title`, `posting_url`, `location`, `eligibility`, `focus_area`, `deadline`, `deadline_text`, `paid_status`, `application_type`, `source_status_raw`.

### Relevance scoring (`src/lib/relevance.ts`)

`scoreOpportunity(draft, config, now)` → `{score: 0–100, reasons: string[]}`.

- Baseline: 40.
- Deadline signals: +15 (≤60d), +10 (>60d), +10 (rolling), +5 (≤7d urgent), −30 (passed), −5 (none).
- Paid status: +15 paid, +10 stipend, −5 unpaid.
- Location local hints: +10.
- No location: −3.
- Undergraduate eligibility: +10; graduate-only: −15.
- Priority focus area (configurable list, empty by default): +10.
- No application link: −10.

The spec (§10) proposes a more detailed rubric. The automated layer should extend `scoreOpportunity` or introduce a parallel scoring pass with the new signals. **Backward-compatible extension is possible** because `ScoringConfig` is already a plain object and `DEFAULT_CONFIG` is an exported constant.

---

## 6. Whether Approved Public Records Are Currently Protected from Silent Overwrites

**Yes, completely.** The protection is implemented in `src/app/admin/import/actions.ts` lines 167–184 and governed by `decideUpdatePolicy` in `src/lib/dedupe.ts`.

When a re-import matches an existing `approved + public_safe` record:
- Only `last_seen_at` is updated.
- `changedFlaggedFields(draft, existing)` computes the set of differing public-facing fields.
- If any fields differ, an `import_changed` review task is inserted with the field names in `notes`.
- The public record is **never mutated** by re-import.

The rule is also documented in `README.md` invariant #3, `docs/03-architecture.md` key boundary #4, and `docs/08-import-dedupe-scoring.md`. The automated connector layer must call the same `decideUpdatePolicy` function (or an equivalent that re-implements the same contract) for any match against an existing opportunity.

---

## 7. Required Additive Database Migrations

The current schema (`supabase/migrations/0001_init.sql`) is not rerun-safe. It uses bare `create type`, `create table`, `create view`, and `create policy` statements without `if not exists`. All future work must be in **separate numbered migration files**.

### 7a. Enum additions (migration 0002)

The `task_type` enum must gain new values for automated-ingestion review tasks:

```sql
-- supabase/migrations/0002_ingestion_enums.sql
alter type task_type add value if not exists 'source_changed';
alter type task_type add value if not exists 'reopen_candidate';
alter type task_type add value if not exists 'closure_candidate';
alter type task_type add value if not exists 'low_score';
```

### 7b. Source registry and fetch infrastructure (migration 0003)

Six new tables per the spec (§6):

**`job_sources`** — machine-usable approved source registry, references `source_records`:
- `id uuid pk`, `source_record_id uuid not null unique → source_records(id)`, `company_id uuid → companies(id)`, `source_name text`, `source_kind text check(...)`, `source_identifier text`, `careers_url text not null`, `api_endpoint text`, `config_json jsonb default '{}'`, `enabled boolean default true`, `priority smallint default 50`, `fetch_interval_hours integer default 24`, `expected_geography text[]`, `expected_audience text[]`, `terms_reviewed boolean default false`, `terms_review_date date`, `robots_reviewed boolean default false`, `notes text`, `created_by uuid → auth.users(id)`, `updated_by uuid → auth.users(id)`, `created_at timestamptz`, `updated_at timestamptz` (trigger).

Allowed `source_kind` values: `greenhouse`, `lever`, `ashby`, `usajobs`, `nih_program`, `nsf_program`, `nasa_program`, `rss`, `schema_org`, `static_html`, `other_api`.

**`source_fetch_runs`** — queue + execution log:
- `id uuid pk`, `job_source_id uuid not null → job_sources(id)`, `trigger_kind text not null` (scheduled/manual/retry/recheck), `status text not null` (pending/running/completed/failed/partial/cancelled), `scheduled_for timestamptz not null`, `started_at timestamptz`, `finished_at timestamptz`, `attempt_no integer default 1`, `worker_id text`, `http_status integer`, `records_seen integer default 0`, `records_new/changed/unchanged/reviewed/closed_candidates integer`, `payload_count integer default 0`, `error_class text` (network/timeout/robots/auth/schema/rate_limit/unexpected), `error_message text`, `log_json jsonb default '{}'`, `created_at timestamptz`.

**`source_payloads`** — raw provenance metadata (raw bytes in a private Storage bucket):
- `id uuid pk`, `source_fetch_run_id uuid not null → source_fetch_runs(id)`, `request_url text not null`, `final_url text`, `content_type text`, `etag text`, `last_modified text`, `status_code integer`, `sha256 text not null`, `size_bytes integer not null`, `storage_path text not null`, `created_at timestamptz`.

**`source_postings`** — one row per source-specific posting identity:
- `id uuid pk`, `job_source_id uuid not null → job_sources(id)`, `external_posting_id text`, `canonical_url text not null`, `identity_key text not null`, normalized title/employer/location fields, `remote_type text`, `employment_type text`, `classification text`, `department text`, `focus_area text`, `posted_at date`, `closes_at date`, `current_status text default 'open'` (open/missing/closed/reopened/unknown), `first_seen_at timestamptz`, `last_seen_at timestamptz`, `last_payload_id uuid → source_payloads(id)`, `last_material_hash text not null`, `consecutive_misses integer default 0`, `created_at/updated_at timestamptz`.
- Unique on `(job_source_id, identity_key)`.

**`source_posting_versions`** — immutable normalized snapshot history:
- `id uuid pk`, `source_posting_id uuid not null → source_postings(id)`, `source_fetch_run_id uuid not null → source_fetch_runs(id)`, `source_payload_id uuid not null → source_payloads(id)`, `is_material_change boolean not null`, `material_hash text not null`, `normalized_json jsonb not null`, `field_diff_json jsonb default '{}'`, `created_at timestamptz`.

**`opportunity_source_links`** — links curated opportunities to automated source observations:
- `id uuid pk`, `opportunity_id uuid not null → opportunities(id)`, `source_posting_id uuid not null → source_postings(id)`, `match_type text not null`, `is_primary boolean default false`, `created_at timestamptz`.
- Unique on `(opportunity_id, source_posting_id)`.

### 7c. RLS additions (same or separate migration)

All six new tables should receive the same `is_officer()` policy pattern:

```sql
alter table job_sources enable row level security;
create policy officer_all_job_sources on job_sources for all
  using (is_officer()) with check (is_officer());
-- ... repeated for each new table
```

No new public views are needed for automation internals.

### 7d. Private Storage bucket

A private Supabase Storage bucket (e.g., `source-payloads`) for raw payload bytes. Access must be restricted to service-role only; no public URL grant. This is a Supabase dashboard step, not a SQL migration, but must be documented as a deployment prerequisite.

### 7e. Migration sequence

1. `0002_ingestion_enums.sql` — enum additions.
2. `0003_ingestion_tables.sql` — six new tables, indexes, triggers, RLS.
3. `0004_ingestion_seed.sql` (optional) — initial approved sources seeded into `source_records` + `job_sources`.
4. Storage bucket creation (Supabase dashboard or `supabase storage` CLI).

---

## 8. Required Application and Administrative-Interface Changes

### 8a. New TypeScript types (`src/lib/types.ts`)

Add types mirroring each new table: `JobSource`, `SourceFetchRun`, `SourcePayload`, `SourcePosting`, `SourcePostingVersion`, `OpportunitySourceLink`. Add new `source_kind` values to a `SourceKind` type. Add new task types to `TaskType`.

### 8b. New connector library (`src/lib/connectors/`)

One module per connector kind. Each exports a function matching the `ConnectorInput → ConnectorOutput` contract (spec §7):

- `src/lib/connectors/greenhouse.ts`
- `src/lib/connectors/lever.ts`
- `src/lib/connectors/ashby.ts`
- `src/lib/connectors/usajobs.ts`
- `src/lib/connectors/static-html.ts` (later phases)
- `src/lib/connectors/normalize/` — shared normalization utilities extending `src/lib/normalize.ts`

### 8c. Connector bridge (`src/lib/connectors/bridge.ts`)

Translates `NormalizedSourcePosting → OpportunityDraft`, calls `matchCompany` / `matchOpportunity` / `decideUpdatePolicy` from the existing `src/lib/dedupe.ts`, calls `scoreOpportunity` from `src/lib/relevance.ts`, inserts into `source_postings` / `source_posting_versions`, and creates or updates `opportunities` + `review_tasks`.

### 8d. Worker route or Edge Function (`src/app/api/ingest/route.ts` or Supabase Edge Function)

Claims pending `source_fetch_runs`, invokes the appropriate connector, calls the bridge, updates run status and counts. Must be server-only; must not require an officer session (uses service-role key in a server-secret context). Must include SSRF guards: allowlist hosts from `job_sources`, block non-HTTP(S) schemes, block RFC1918 targets.

### 8e. Admin source registry pages

- `src/app/admin/sources/page.tsx` — table of approved sources with: enabled toggle, source kind, organization, last successful fetch, consecutive failures, next scheduled, terms/robots reviewed.
- `src/app/admin/sources/[id]/page.tsx` — source detail: careers URL, connector type, config JSON, last 10 fetch runs, recent errors, actions (run now, disable, retry).

### 8f. Extended review queue filters

Add filter chips to `src/app/admin/review/page.tsx` for: source (automated vs. manual), score band, changed-existing-record, probable duplicate, stale/missing, employer.

### 8g. Field-level diff panel

For `import_changed` and `source_changed` review tasks, render a two-column diff: current approved values vs. incoming source values.

### 8h. Health dashboard card

Add a card to `src/app/admin/page.tsx` showing: total enabled sources, failed in last 24 h, sources disabled by auto-circuit-breaker, pending review count from automation.

---

## 9. Security and Operational Risks

### 9a. Service-role key expansion (High)

The current pattern (`requireOfficer()` → `createServiceClient()`) is safe for interactive server actions. Scheduled Edge Functions that call `createServiceClient()` without `requireOfficer()` are executing with unrestricted DB access. Any misconfiguration that routes a preview deployment to production Supabase with the service-role key active creates a privileged attack surface.

**Mitigation:** Separate staging Supabase project for previews; no service-role key in preview env vars; env var audit in production-hardening phase (spec phase 8).

### 9b. SSRF through connector fetch targets (High)

Connectors fetch arbitrary URLs from `job_sources.careers_url` and `api_endpoint`. A malicious or misconfigured source record could cause the worker to fetch internal metadata endpoints (e.g., `169.254.169.254`).

**Mitigation:** Allowlist-only fetch from `job_sources` hosts; reject non-HTTP(S) schemes; reject localhost and RFC1918 CIDR ranges and known cloud metadata IPs; follow at most one redirect; cap response size.

### 9c. Stored raw content / XSS (Medium)

ATS job descriptions may contain HTML or script content. If any part of a job description is rendered without escaping, XSS is possible.

**Mitigation:** Convert description HTML to plain text during normalization; never use `dangerouslySetInnerHTML` for external content in admin or public UI; escape all officer-facing text through React's default escaping.

### 9d. CSV formula injection (Low, pre-existing)

The existing CSV export route is not audited in this phase. Future exports of fetched data should strip leading `=`, `+`, `-`, `@` characters from user-controlled text fields.

### 9e. Preview deployment mutations (High)

Vercel preview deployments share the same `SUPABASE_SERVICE_ROLE_KEY` by default if env vars are set at the team level. A scheduled function triggered during a preview build could mutate production data.

**Mitigation:** Scope `SUPABASE_SERVICE_ROLE_KEY` to Production environment only in Vercel; use a staging Supabase project for Preview environments.

### 9f. Queue concurrency (Medium)

Two worker invocations claiming from `source_fetch_runs` concurrently could double-process a source run, inserting duplicate `source_postings` and `review_tasks`.

**Mitigation:** Use a database-level claim with `UPDATE ... RETURNING` and a `status` transition (`pending → running`) inside a single statement or transaction; verify worker uniqueness by `worker_id`.

### 9g. False closure of active postings (Medium)

A single failed fetch (network timeout, 503) must not mark a posting as closed. The spec is explicit: only repeated misses above a configurable threshold should trigger closure-candidate review.

**Mitigation:** `consecutive_misses` counter on `source_postings`; configurable threshold per source kind; no auto-deletion, only review task creation.

### 9h. Officer review overload (Medium)

If scoring thresholds are loose or the source registry is too broad, the review queue could be flooded with irrelevant records. This degrades the officer experience and may lead to approving records without due diligence.

**Mitigation:** Curated initial source registry (10–15 sources for first pass); hard exclusion rules pre-filter; configurable score threshold below which records are auto-rejected before entering the review queue; source-level kill switch.

### 9i. Terms/robots compliance (Medium)

Fetching from sources without reviewing their `robots.txt` or terms of service could violate platform policies.

**Mitigation:** `terms_reviewed` and `robots_reviewed` boolean fields on `job_sources`; the source registry page must show these flags; officer must explicitly set both before a source is enabled; the `static_html` connector should check the `robots_reviewed` flag and refuse to run if it is false.

### 9j. Source-schema breakage (High likelihood, Medium impact)

ATS vendors can change JSON shapes without notice. A connector that receives an unexpected schema may either silently ingest malformed data or crash.

**Mitigation:** Per-connector test fixtures; connector version field; `schema` error class in `source_fetch_runs.error_class`; auto-disable after configurable consecutive failures; never ingest partial/malformed data silently.

---

## 10. Conflicts Between the Research Specification and the Actual Repository

| # | Specification assumption | Actual state | Resolution |
|---|---|---|---|
| 1 | spec §6 refers to `source_type` needing new values for automated kinds (greenhouse, lever, etc.) | Existing `source_type` enum has only: `spreadsheet`, `manual`, `student_submission`, `partner`, `website_page`. Automated ATS kinds are not present. | Add automated kinds to a new check constraint on `job_sources.source_kind` rather than extending the existing `source_type` enum. The `job_sources` table is the right place for machine-kind metadata; `source_records.source_type` can stay as-is with `website_page` covering automated sources. |
| 2 | spec §6 `task_type` additions (`source_changed`, `reopen_candidate`, `closure_candidate`, `low_score`) | Current `task_type` enum lacks these values. Adding values to Postgres enums requires `ALTER TYPE ... ADD VALUE` which is not transactional in all Postgres versions; it cannot be rolled back in the same transaction. | Add in a separate migration file (0002) applied before the table migration (0003). Use `if not exists` where possible. |
| 3 | spec §11 recommends Supabase Cron + Edge Functions as the MVP scheduler. | The current deployment is Vercel + hosted Supabase (free tier). Supabase Edge Functions and Cron are available on free tier but with shorter wall-clock limits. | Accept the spec recommendation. Edge Functions are the right fit for the database-local secret pattern. Note in handoff docs that free-plan Edge Function duration limits constrain batch size; conservative batching (5–10 sources per invocation) is required. |
| 4 | spec §7 defines `ConnectorOutput` with raw bytes stored in a private bucket. | No Supabase Storage bucket currently exists in the project. | Create a private bucket during deployment. Document as a Phase 1 prerequisite. |
| 5 | spec §10 proposes a more detailed scoring rubric (base 40, undergraduate eligibility +20, internship classification +15, SoCal +10, etc.) with different point values than the current `relevance.ts` implementation. | Current `scoreOpportunity` uses: base 40, paid +15, deadline signals +5/+10/+15/−30, eligibility +10/−15, location +10, focus +10, no link −10. | The automated layer should use an **extended scoring function** that adds the new signals. The existing `scoreOpportunity` serves manual imports unchanged. New connector bridge may call a `scoreAutomatedOpportunity` wrapper or extend `ScoringConfig`. Both must be updated in the same PR if enums change. |
| 6 | spec §2 states "`source_records` already includes `url`, `refresh_policy`, `last_imported_at`, `last_reviewed_at`" and anticipates web-originated data. | This is confirmed accurate. `source_type` includes `website_page`. | No conflict — confirms the extension plan is sound. |
| 7 | spec §2 notes "the migration is not idempotent in a rerun-safe sense". | Confirmed: `0001_init.sql` uses bare `create type/table/view/policy`. | All new migrations must use additive, guarded forms. `0001_init.sql` must never be re-executed. |
| 8 | `HANDOFF.md` rule: "Never add code that automatically pulls data from external websites". | This rule reflects current M1-MVP state. The automated ingestion project is explicitly authorized by the owner as a future phase. | Rule should be updated when Phase 1 is merged to reflect the allowed automated-ingestion path. Until then, no fetching code should exist in production. |

---

## 11. Components That Should Remain Unchanged

The following components have no changes required in any phase of the automated ingestion project. They must not be modified except for clearly documented backward-compatible extensions (e.g., adding new filter options to an existing UI without breaking existing ones):

| Component | Reason |
|---|---|
| `supabase/migrations/0001_init.sql` | One-time bootstrap; not rerun-safe; all automation schema goes in new files |
| `supabase/seed.sql` | Creates the demo row and canonical sources; officers run this once |
| `supabase/seed_historical.sql` | Historical archive; run once; automation does not touch archive records |
| `src/lib/supabase/server.ts` | Client factory and `requireOfficer()` are correct and complete |
| `src/middleware.ts` | Session gate is correct; no changes needed for automation |
| `src/app/admin/import/actions.ts` | Manual CSV import pipeline; unchanged; automation uses a parallel worker |
| `src/lib/csvImport.ts` | Header mapping and `rowToDraft`; unchanged |
| `src/lib/dedupe.ts` | Dedupe logic and `decideUpdatePolicy`; automation reuses these; no changes |
| `src/lib/normalize.ts` | Normalization primitives; new connector utilities extend, not replace |
| `src/lib/relevance.ts` | Existing scoring; automation extends via new config/wrapper |
| `src/app/admin/review/actions.ts` | `approveOpportunity`, `rejectOpportunity`, `markDuplicate`; correct and complete |
| `src/app/internships/page.tsx`, `board.tsx` | Public board; reads only `public_opportunities` |
| `src/app/companies/page.tsx` | Company directory; reads only `public_companies` |
| `src/app/submit/page.tsx` | Student submission form |
| `src/app/admin/login/page.tsx` | Login page |
| `src/app/api/export/route.ts` | CSV/JSON export |
| `src/app/admin/add/` | Quick-add form |
| `src/app/admin/duplicates/` | Duplicate review UI |
| All `public_*` views | Public data boundary; must remain unchanged |
| `.github/workflows/ci.yml` | Existing typecheck + build CI; automation phases may add a test job but must not modify existing jobs |

---

## 12. Phased, File-Level Implementation Plan

### Phase 0 (current): Repository audit

- **Output:** `docs/automated-ingestion-audit.md` (this file).
- **DB changes:** none.
- **App changes:** none.

### Phase 1: Source registry

| File | Action |
|---|---|
| `supabase/migrations/0002_ingestion_enums.sql` | Create — add new `task_type` values |
| `supabase/migrations/0003_ingestion_tables.sql` | Create — `job_sources`, `source_fetch_runs`, `source_payloads`, `source_postings`, `source_posting_versions`, `opportunity_source_links`; indexes; triggers; RLS |
| `supabase/migrations/0004_ingestion_seed.sql` | Create (optional) — seed first approved sources |
| `src/lib/types.ts` | Edit — add `JobSource`, `SourceFetchRun`, `SourcePayload`, `SourcePosting`, `SourcePostingVersion`, `OpportunitySourceLink`, `SourceKind`; extend `TaskType` |
| `src/app/admin/sources/page.tsx` | Create — source registry list |
| `src/app/admin/sources/[id]/page.tsx` | Create — source detail and controls |
| `src/app/admin/sources/actions.ts` | Create — `createJobSource`, `updateJobSource`, `toggleSourceEnabled` (all guarded by `requireOfficer`) |
| `src/app/admin/page.tsx` | Edit — add health dashboard card |

### Phase 2: Greenhouse connector

| File | Action |
|---|---|
| `src/lib/connectors/normalize/index.ts` | Create — extended normalization utilities (employer, title, location, compensation, dates) |
| `src/lib/connectors/greenhouse.ts` | Create — `ConnectorInput → ConnectorOutput` |
| `src/lib/connectors/bridge.ts` | Create — `NormalizedSourcePosting → opportunity upsert + review task` |
| `src/app/api/ingest/route.ts` | Create — worker route: claim pending runs, invoke connector, call bridge, update run (or Supabase Edge Function equivalent) |
| `src/lib/relevance.ts` | Edit (backward-compatible) — extend `ScoringConfig` with new automated signals or add `scoreAutomatedOpportunity` |
| `src/lib/types.ts` | Edit — add `NormalizedSourcePosting` type |

### Phase 3: Lever connector

| File | Action |
|---|---|
| `src/lib/connectors/lever.ts` | Create |
| Tests for Lever fixtures | Create under `src/lib/connectors/__tests__/` |

### Phase 4: Ashby connector

| File | Action |
|---|---|
| `src/lib/connectors/ashby.ts` | Create — include preflight public-access check |
| `src/app/admin/sources/[id]/page.tsx` | Edit — show Ashby preflight status |

### Phase 5: Scheduler and batched workers

| File | Action |
|---|---|
| `supabase/functions/ingest-scheduler/index.ts` | Create — Supabase Edge Function: insert pending `source_fetch_runs` for due sources |
| `supabase/functions/ingest-worker/index.ts` | Create — claim + process batch; call connector; update run; isolation per source |
| `src/app/admin/sources/[id]/page.tsx` | Edit — "Run now" button calls worker trigger |

### Phase 6: Stale-record detection

| File | Action |
|---|---|
| `supabase/functions/ingest-worker/index.ts` | Edit — update `consecutive_misses`; create `closure_candidate` review tasks after threshold |
| `supabase/migrations/0005_stale_tracking.sql` | Create (if additional columns needed on `source_postings`) |

### Phase 7: Admin source health dashboard and diff review UI

| File | Action |
|---|---|
| `src/app/admin/sources/page.tsx` | Edit — add failure counts, next-due column, circuit-breaker status |
| `src/app/admin/review/page.tsx` | Edit — add source/score-band/changed-record filter chips |
| `src/app/admin/review/review-list.tsx` | Edit — add field-level diff panel for `source_changed` / `import_changed` tasks |

### Phase 8: Production hardening

| File | Action |
|---|---|
| `docs/automated-ingestion-audit.md` | Update — final security checklist |
| `HANDOFF.md` | Edit — update rule about external data fetching; add source-management runbook |
| `supabase/migrations/0006_audit_events.sql` | Create (optional) — immutable audit event log |
| `.github/workflows/ci.yml` | Edit (additive only) — add unit test job |
| Vercel dashboard | Config — scope `SUPABASE_SERVICE_ROLE_KEY` to Production environment only |

---

## 13. Acceptance Criteria for the Database-Schema Phase (Phase 1)

The following tests must pass before any connector code is merged:

| Test | Pass condition |
|---|---|
| Fresh-DB migration smoke | Running `0001_init.sql` → `0002` → `0003` → `0004` on a blank Postgres instance succeeds with no errors |
| RLS verification on new tables | `set role anon; select * from job_sources;` → denied; `select * from source_fetch_runs;` → denied |
| Officer-only write | Officer session can `INSERT` into `job_sources`; anon session cannot |
| `is_officer()` re-check | `set role authenticated; select is_officer();` returns `false` for a non-officer user |
| FK integrity | Inserting a `source_fetch_runs` row with a nonexistent `job_source_id` fails with FK error |
| Unique constraint | Inserting two `job_sources` rows with the same `source_record_id` fails |
| `opportunity_source_links` uniqueness | Two rows with the same `(opportunity_id, source_posting_id)` fail |
| `task_type` enum expansion | Inserting `review_tasks` with `task_type = 'source_changed'` succeeds |
| No change to existing tables | `\d opportunities`, `\d companies`, `\d review_tasks` output identical to post-`0001` schema (except `task_type` enum) |
| Public views unchanged | `select * from public_opportunities limit 1;` returns the same columns as before |
| Re-import idempotency (pre-existing) | Re-importing the seed CSV against the extended schema still does not alter the demo approved record |

---

## 14. Blockers and Assumptions Requiring Owner Review

| # | Blocker / Assumption | Detail | Action required |
|---|---|---|---|
| B1 | **Supabase plan for Edge Functions** | Supabase free plan has shorter Edge Function wall-clock limits than paid. The spec recommends Supabase Cron + Edge Functions as the MVP scheduler. If the free-plan limits are too short for batch processing (5–10 sources per invocation), the owner must decide whether to upgrade or switch to Vercel server routes as the worker (losing Supabase-local secret advantages). | Owner to confirm Supabase plan at ingestion build time. |
| B2 | **Private Storage bucket for raw payloads** | The spec requires a private bucket for raw payload bytes. This is a Supabase dashboard action that cannot be in a SQL migration. Someone with Supabase project-owner access must create it before Phase 1 is deployed. | Owner to create bucket during Phase 1 deployment. |
| B3 | **Preview deployment secret isolation** | Vercel preview deployments likely share the production `SUPABASE_SERVICE_ROLE_KEY` if it is set at the team level. The spec is explicit that this is a production-risk issue. The owner must decide: (a) scope the service-role key to Production environment only (previews get no key), or (b) provision a separate staging Supabase project for previews. | Owner decision before Phase 5 (scheduler). |
| B4 | **HANDOFF.md rule contradiction** | `HANDOFF.md` currently states "Never add code that automatically pulls data from external websites." The automated ingestion project directly contradicts this rule. The owner must update the rule when Phase 1 is merged to reflect the authorized automated-ingestion path and its operator controls. | Owner to update HANDOFF.md (or confirm the agent can update it) at Phase 1 merge. |
| B5 | **`task_type` enum ALTER TYPE transactionality** | In Postgres 12+, `ALTER TYPE ... ADD VALUE` is not transactional — it commits immediately and cannot be rolled back. If migration 0002 is applied and then 0003 fails, the enum is already extended. This is generally safe but must be documented so future migration authors know not to rely on enum additions being rollback-safe. | Owner to acknowledge. No action needed beyond documentation. |
| B6 | **USAJOBS API key** | USAJOBS requires a free API key (registered via developer.usajobs.gov). The key must be stored as a Supabase secret or Vercel env var, never in source code. The connector cannot be enabled without it. | Officer to register and store key before enabling the USAJOBS source. |
| B7 | **Source terms/robots review** | Each employer or program source must have its terms of service and `robots.txt` reviewed before the source is enabled. The `terms_reviewed` and `robots_reviewed` boolean fields enforce this at the database level, but an officer must actually perform the review. No connector should be enabled with `terms_reviewed = false`. | Officer action per source, not a code change. |
| B8 | **Scoring rubric migration** | The spec proposes different point values for the extended scoring rubric (e.g., undergraduate eligibility +20 vs. current +10). Changing the scoring of existing manual-import records retroactively would alter relevance ordering. The owner must decide whether to: (a) apply new scoring to automated records only, or (b) re-score all records. | Owner decision before Phase 2. |
| A1 | **Assumption: Supabase Postgres version ≥ 14** | The Postgres `gen_random_uuid()` function used throughout the schema is built-in at PG 13+. The `pg_trgm` extension is installed. Assumption: the hosted Supabase project is on a compatible version. | Verify via Supabase dashboard if needed. |
| A2 | **Assumption: no existing `job_sources`-like table** | The audit found no such table in `0001_init.sql` or any other migration file. The migration plan assumes it is safe to create `job_sources` as a new table. | Confirmed by audit. |
| A3 | **Assumption: connector code is TypeScript** | All existing application code is TypeScript. Supabase Edge Functions support Deno/TypeScript. The connector library will be TypeScript; Deno-compatible imports may require path adjustments if Edge Functions import from `src/lib/`. | This may require a `supabase/functions/` directory with its own `deno.json` or import map. Owner to confirm Edge Function import strategy at Phase 5. |

---

*End of audit. This document should be updated at the start of each implementation phase with findings from that phase's code review.*
