-- Phase 1 automated ingestion schema foundation.
-- Depends on 0001_init.sql (source_records, companies, opportunities, is_officer, set_updated_at)
-- and 0002_ingestion_task_types.sql (task_type enum values must be committed first).

-- ============================================================
-- TABLES
-- ============================================================

-- job_sources: machine-readable approved source registry.
-- Each row is anchored to an existing source_records row for provenance.
-- A source may only be enabled once both terms_reviewed and robots_reviewed are true,
-- and terms_review_date is set.
create table if not exists public.job_sources (
  id                              uuid primary key default gen_random_uuid(),
  source_record_id                uuid not null unique
                                    references public.source_records(id) on delete restrict,
  company_id                      uuid references public.companies(id) on delete set null,
  source_name                     text not null check (trim(source_name) <> ''),
  source_kind                     text not null check (
                                    source_kind in (
                                      'greenhouse','lever','ashby','usajobs',
                                      'schema_org','static_html','rss','other_api'
                                    )
                                  ),
  source_identifier               text,
  careers_url                     text not null check (trim(careers_url) <> ''),
  api_endpoint                    text,
  config_json                     jsonb not null default '{}'::jsonb
                                    check (jsonb_typeof(config_json) = 'object'),
  enabled                         boolean not null default false,
  priority                        smallint not null default 50
                                    check (priority >= 0 and priority <= 100),
  fetch_interval_hours            integer not null default 24 check (fetch_interval_hours > 0),
  expected_geography              text[] not null default '{}',
  expected_audience               text[] not null default '{}',
  terms_reviewed                  boolean not null default false,
  terms_review_date               date,
  robots_reviewed                 boolean not null default false,
  last_attempted_at               timestamptz,
  last_successful_at              timestamptz,
  consecutive_failures            integer not null default 0 check (consecutive_failures >= 0),
  last_http_status                integer
                                    check (last_http_status is null or (last_http_status >= 100 and last_http_status <= 599)),
  last_payload_hash               text
                                    check (last_payload_hash is null or last_payload_hash ~ '^[0-9a-f]{64}$'),
  degraded_at                     timestamptz,
  automatic_scheduling_paused_at  timestamptz,
  notes                           text,
  created_by                      uuid references auth.users(id) on delete set null,
  updated_by                      uuid references auth.users(id) on delete set null,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  -- terms_review_date may only be set when terms_reviewed is true
  constraint job_sources_terms_date_requires_terms_review check (
    terms_review_date is null or terms_reviewed
  ),
  -- enabled requires both policy reviews complete
  constraint job_sources_enablement_requires_policy_review check (
    not enabled or (
      terms_reviewed
      and robots_reviewed
      and terms_review_date is not null
    )
  )
);

-- source_fetch_runs: execution queue and run history.
-- Rows transition: pending → running → completed | failed | partial | cancelled.
-- Workers use claim_source_fetch_runs() to atomically lease pending rows.
create table if not exists public.source_fetch_runs (
  id                       uuid primary key default gen_random_uuid(),
  job_source_id            uuid not null references public.job_sources(id) on delete restrict,
  trigger_kind             text not null
                             check (trigger_kind in ('scheduled','manual','retry','recheck')),
  status                   text not null
                             check (status in ('pending','running','completed','failed','partial','cancelled')),
  scheduled_for            timestamptz not null,
  started_at               timestamptz,
  finished_at              timestamptz,
  attempt_no               integer not null default 1 check (attempt_no >= 1),
  worker_id                text,
  http_status              integer check (http_status is null or (http_status >= 100 and http_status <= 599)),
  records_seen             integer not null default 0 check (records_seen >= 0),
  records_new              integer not null default 0 check (records_new >= 0),
  records_changed          integer not null default 0 check (records_changed >= 0),
  records_unchanged        integer not null default 0 check (records_unchanged >= 0),
  records_reviewed         integer not null default 0 check (records_reviewed >= 0),
  records_closed_candidates integer not null default 0 check (records_closed_candidates >= 0),
  payload_count            integer not null default 0 check (payload_count >= 0),
  error_class              text check (
                             error_class is null or error_class in (
                               'network','timeout','robots','auth','schema','rate_limit','unexpected'
                             )
                           ),
  error_message            text,
  log_json                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  -- finished_at may be set only when started_at is also set
  constraint source_fetch_runs_finished_requires_started check (
    finished_at is null or started_at is not null
  ),
  -- finished_at must not precede started_at
  constraint source_fetch_runs_finished_after_started check (
    finished_at is null or started_at is null or finished_at >= started_at
  )
);

-- source_payloads: raw provenance metadata.
-- Raw bytes are stored in the private source-payloads bucket (see 0004).
-- This row keeps the hash and storage reference for auditability.
create table if not exists public.source_payloads (
  id                   uuid primary key default gen_random_uuid(),
  source_fetch_run_id  uuid not null references public.source_fetch_runs(id) on delete cascade,
  request_url          text not null check (trim(request_url) <> ''),
  final_url            text,
  content_type         text,
  etag                 text,
  last_modified        text,
  status_code          integer check (status_code is null or (status_code >= 100 and status_code <= 599)),
  sha256               text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes           integer not null check (size_bytes >= 0),
  storage_path         text not null check (trim(storage_path) <> ''),
  created_at           timestamptz not null default now()
);

-- source_postings: one row per source-specific posting identity, with current state.
-- identity_key is a deterministic composite built by the connector; unique per source.
create table if not exists public.source_postings (
  id                       uuid primary key default gen_random_uuid(),
  job_source_id            uuid not null references public.job_sources(id) on delete restrict,
  external_posting_id      text,
  canonical_url            text not null check (trim(canonical_url) <> ''),
  identity_key             text not null check (trim(identity_key) <> ''),
  employer_name_raw        text,
  employer_name_normalized text,
  title_raw                text,
  title_normalized         text,
  location_raw             text,
  location_normalized      text,
  remote_type              text check (
                             remote_type is null or remote_type in ('remote','hybrid','onsite','unknown')
                           ),
  employment_type          text,
  classification           text check (
                             classification is null or classification in (
                               'internship','entry_level','fellowship','research','other'
                             )
                           ),
  department               text,
  focus_area               text,
  posted_at                date,
  closes_at                date,
  deadline_kind            text check (
                             deadline_kind is null or deadline_kind in ('hard','rolling','unknown')
                           ),
  current_status           text not null default 'open' check (
                             current_status in (
                               'open','missing','closure_candidate','closed','reopened','unknown'
                             )
                           ),
  relevance_score          integer check (
                             relevance_score is null or (relevance_score >= 0 and relevance_score <= 100)
                           ),
  relevance_score_version  smallint check (relevance_score_version is null or relevance_score_version > 0),
  score_breakdown_json     jsonb not null default '{}'::jsonb,
  uncertainty_flags        text[] not null default '{}',
  closure_confidence       numeric(5,4) not null default 0
                             check (closure_confidence >= 0 and closure_confidence <= 1),
  first_seen_at            timestamptz not null default now(),
  last_seen_at             timestamptz not null default now(),
  last_payload_id          uuid references public.source_payloads(id) on delete set null,
  last_material_hash       text not null check (last_material_hash ~ '^[0-9a-f]{64}$'),
  consecutive_misses       integer not null default 0 check (consecutive_misses >= 0),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint source_postings_seen_window_valid check (last_seen_at >= first_seen_at),
  constraint source_postings_closes_after_posted check (
    closes_at is null or posted_at is null or closes_at >= posted_at
  ),
  constraint source_postings_relevance_score_pair check (
    (relevance_score is null and relevance_score_version is null)
    or (relevance_score is not null and relevance_score_version is not null)
  )
);

-- source_posting_versions: immutable normalized snapshot history.
-- Each row is created by the worker once per material or initial observation.
-- An append-only trigger (below) prevents UPDATE and DELETE by any session,
-- including authenticated officers. service_role bypasses RLS but NOT triggers,
-- so append-only behavior is universal.
create table if not exists public.source_posting_versions (
  id                   uuid primary key default gen_random_uuid(),
  source_posting_id    uuid not null references public.source_postings(id) on delete restrict,
  source_fetch_run_id  uuid not null references public.source_fetch_runs(id) on delete restrict,
  source_payload_id    uuid not null references public.source_payloads(id) on delete restrict,
  connector_version    text not null check (trim(connector_version) <> ''),
  is_material_change   boolean not null,
  material_hash        text not null check (material_hash ~ '^[0-9a-f]{64}$'),
  normalized_json      jsonb not null,
  score_breakdown_json jsonb not null default '{}'::jsonb,
  field_diff_json      jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);

-- opportunity_source_links: map curated opportunities to machine-observed postings.
-- At most one is_primary link per opportunity (enforced by partial unique index below).
create table if not exists public.opportunity_source_links (
  id                 uuid primary key default gen_random_uuid(),
  opportunity_id     uuid not null references public.opportunities(id) on delete restrict,
  source_posting_id  uuid not null references public.source_postings(id) on delete restrict,
  match_type         text not null check (
                       match_type in ('exact','probable','manual','annual_family','alternate_source')
                     ),
  is_primary         boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (opportunity_id, source_posting_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_job_sources_enabled_priority
  on public.job_sources(enabled, priority);
create index if not exists idx_job_sources_enabled_interval
  on public.job_sources(enabled, fetch_interval_hours);
create index if not exists idx_job_sources_company_id
  on public.job_sources(company_id);
create index if not exists idx_job_sources_paused_at
  on public.job_sources(automatic_scheduling_paused_at);

create index if not exists idx_source_fetch_runs_job_source_scheduled_desc
  on public.source_fetch_runs(job_source_id, scheduled_for desc);
create index if not exists idx_source_fetch_runs_status_scheduled_for
  on public.source_fetch_runs(status, scheduled_for);
-- Partial index covering only active queue entries for fast scheduler polling.
create index if not exists idx_source_fetch_runs_active_queue
  on public.source_fetch_runs(scheduled_for)
  where status in ('pending', 'running');

create unique index if not exists idx_source_payloads_run_sha_request
  on public.source_payloads(source_fetch_run_id, sha256, request_url);
create index if not exists idx_source_payloads_run_id
  on public.source_payloads(source_fetch_run_id);

-- Uniqueness for source posting identity (enforced here for partial-index support).
create unique index if not exists idx_source_postings_source_identity
  on public.source_postings(job_source_id, identity_key);
create index if not exists idx_source_postings_source_status
  on public.source_postings(job_source_id, current_status);
create index if not exists idx_source_postings_last_seen_at
  on public.source_postings(last_seen_at);
create index if not exists idx_source_postings_closes_at
  on public.source_postings(closes_at);

create index if not exists idx_source_posting_versions_posting_created_desc
  on public.source_posting_versions(source_posting_id, created_at desc);
create index if not exists idx_source_posting_versions_material_hash
  on public.source_posting_versions(material_hash);

-- At most one primary source link per opportunity.
create unique index if not exists idx_opportunity_source_links_one_primary
  on public.opportunity_source_links(opportunity_id)
  where is_primary;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- updated_at triggers for job_sources and source_postings.
do $$
declare
  t text;
begin
  foreach t in array array['job_sources', 'source_postings'] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = to_regclass(format('public.%I', t))
        and tgname = format('trg_%s_updated', t)
    ) then
      execute format(
        'create trigger trg_%s_updated before update on public.%I
           for each row execute function public.set_updated_at()',
        t, t
      );
    end if;
  end loop;
end
$$;

-- Append-only enforcement for source_posting_versions.
-- This trigger fires for EVERY session role including service_role because triggers
-- apply at the database level, independent of RLS bypass. service_role bypasses RLS
-- but does NOT bypass triggers. Officers cannot delete or update version rows.
-- Workers should only INSERT new version rows; the trigger is a safety net.
create or replace function public.prevent_source_posting_versions_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'source_posting_versions is append-only: UPDATE and DELETE are not permitted (role: %)',
    current_user;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.source_posting_versions'::regclass
      and tgname = 'trg_source_posting_versions_append_only'
  ) then
    create trigger trg_source_posting_versions_append_only
      before update or delete on public.source_posting_versions
      for each row
      execute function public.prevent_source_posting_versions_mutation();
  end if;
end
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Principle: anon has no access. Authenticated officers may SELECT all six tables.
-- They may not INSERT, UPDATE, or DELETE any table directly — job_sources mutations
-- are performed server-side via service-role after requireOfficer() validation (Phase 7).
-- service_role bypasses RLS entirely; no additional policies are needed for it.

alter table public.job_sources              enable row level security;
alter table public.source_fetch_runs        enable row level security;
alter table public.source_payloads          enable row level security;
alter table public.source_postings          enable row level security;
alter table public.source_posting_versions  enable row level security;
alter table public.opportunity_source_links enable row level security;

-- Revoke all privileges from anon and authenticated before granting minimum required.
revoke all on public.job_sources              from anon, authenticated;
revoke all on public.source_fetch_runs        from anon, authenticated;
revoke all on public.source_payloads          from anon, authenticated;
revoke all on public.source_postings          from anon, authenticated;
revoke all on public.source_posting_versions  from anon, authenticated;
revoke all on public.opportunity_source_links from anon, authenticated;

-- Grant SELECT on all six tables to authenticated (RLS below limits to officers).
grant select on public.job_sources              to authenticated;
grant select on public.source_fetch_runs        to authenticated;
grant select on public.source_payloads          to authenticated;
grant select on public.source_postings          to authenticated;
grant select on public.source_posting_versions  to authenticated;
grant select on public.opportunity_source_links to authenticated;

-- Grant explicit least-privilege table privileges to service_role.
revoke all on public.job_sources, public.source_fetch_runs, public.source_payloads,
             public.source_postings, public.source_posting_versions,
             public.opportunity_source_links from service_role;

grant select, insert, update on public.job_sources to service_role;
grant select, insert, update on public.source_fetch_runs to service_role;
grant select, insert on public.source_payloads to service_role;
grant select, insert, update on public.source_postings to service_role;
grant select, insert on public.source_posting_versions to service_role;
grant select, insert, update, delete on public.opportunity_source_links to service_role;

-- RLS policies — authenticated officer SELECT on all six tables.
do $$
declare
  t text;
  pname text;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    pname := format('officer_select_%s', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = pname
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.is_officer())',
        pname, t
      );
    end if;
  end loop;
end
$$;

-- Phase 7 note: job_sources mutations (INSERT and UPDATE) will run server-side,
-- calling requireOfficer() and using the service-role Supabase client after
-- authorization.  No direct authenticated INSERT or UPDATE grant is issued here.

-- ============================================================
-- QUEUE CLAIM FUNCTION
-- ============================================================
-- claim_source_fetch_runs(p_worker_id, p_limit)
--
-- Purpose: atomically lease up to p_limit pending runs for a named worker,
--          preventing duplicate claims by concurrent callers.
--
-- SECURITY INVOKER: the function runs as the calling role (service_role in
-- normal operation). All referenced objects are schema-qualified, and the
-- search_path is set to pg_catalog, pg_temp to prevent injection.
-- EXECUTE is restricted to service_role only.
--
-- Parameters:
--   p_worker_id  nonempty text identifying the caller (e.g. worker instance id)
--   p_limit      integer 1–50 inclusive; null or out-of-range values raise an exception
--
-- Concurrency: FOR UPDATE SKIP LOCKED ensures that two concurrent callers each
-- receive a disjoint set of rows. The UPDATE is part of the same statement so no
-- row is claimed twice.

create or replace function public.claim_source_fetch_runs(
  p_worker_id text,
  p_limit     integer default 1
)
returns setof public.source_fetch_runs
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_worker_id is null or trim(p_worker_id) = '' then
    raise exception 'claim_source_fetch_runs: p_worker_id must be a nonempty string';
  end if;

  if p_limit is null then
    raise exception 'claim_source_fetch_runs: p_limit must not be null';
  end if;

  if p_limit < 1 or p_limit > 50 then
    raise exception 'claim_source_fetch_runs: p_limit must be between 1 and 50 inclusive, got %', p_limit;
  end if;

  return query
  with claimed as (
    select sfr.id
    from public.source_fetch_runs sfr
    join public.job_sources js on js.id = sfr.job_source_id
    where sfr.status = 'pending'
      and sfr.scheduled_for <= now()
      and js.enabled
      and js.automatic_scheduling_paused_at is null
    order by js.priority asc, sfr.scheduled_for asc, sfr.created_at asc
    for update of sfr skip locked
    limit p_limit
  )
  update public.source_fetch_runs sfr
     set status      = 'running',
         started_at  = coalesce(sfr.started_at, now()),
         worker_id   = p_worker_id
    from claimed
   where sfr.id = claimed.id
  returning sfr.*;
end;
$$;

-- Revoke EXECUTE from PUBLIC (covers all roles including anon and authenticated).
revoke execute on function public.claim_source_fetch_runs(text, integer) from public;
-- Belt-and-suspenders: explicit revoke for anon and authenticated.
revoke execute on function public.claim_source_fetch_runs(text, integer) from anon;
revoke execute on function public.claim_source_fetch_runs(text, integer) from authenticated;
-- Grant only to service_role.
grant execute on function public.claim_source_fetch_runs(text, integer) to service_role;
