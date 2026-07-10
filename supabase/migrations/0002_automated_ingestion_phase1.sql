-- Phase 1 automated ingestion schema foundation.

-- Extend review task types for automated ingestion workflows.
do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_new'
  ) then
    alter type task_type add value 'source_new';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_changed'
  ) then
    alter type task_type add value 'source_changed';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_reopened'
  ) then
    alter type task_type add value 'source_reopened';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'task_type' and e.enumlabel = 'source_health'
  ) then
    alter type task_type add value 'source_health';
  end if;
end
$$;

create table if not exists job_sources (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid not null unique references source_records(id) on delete restrict,
  company_id uuid references companies(id) on delete set null,
  source_name text not null,
  source_kind text not null check (
    source_kind in (
      'greenhouse','lever','ashby','usajobs','nih_program','nsf_program','nasa_program',
      'rss','schema_org','static_html','other_api'
    )
  ),
  source_identifier text,
  careers_url text not null,
  api_endpoint text,
  config_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default false,
  priority smallint not null default 50 check (priority >= 0),
  fetch_interval_hours integer not null default 24 check (fetch_interval_hours > 0),
  expected_geography text[] not null default '{}',
  expected_audience text[] not null default '{}',
  terms_reviewed boolean not null default false,
  terms_review_date date,
  robots_reviewed boolean not null default false,
  last_attempted_at timestamptz,
  last_successful_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_http_status integer,
  last_payload_hash text,
  degraded_at timestamptz,
  automatic_scheduling_paused_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_sources_terms_date_requires_terms_review check (
    terms_review_date is null or terms_reviewed
  ),
  constraint job_sources_enablement_requires_policy_review check (
    not enabled or (
      terms_reviewed
      and robots_reviewed
      and terms_review_date is not null
      and automatic_scheduling_paused_at is null
    )
  )
);

create table if not exists source_fetch_runs (
  id uuid primary key default gen_random_uuid(),
  job_source_id uuid not null references job_sources(id) on delete restrict,
  trigger_kind text not null check (trigger_kind in ('scheduled','manual','retry','recheck')),
  status text not null check (status in ('pending','running','completed','failed','partial','cancelled')),
  scheduled_for timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  attempt_no integer not null default 1 check (attempt_no >= 1),
  worker_id text,
  http_status integer,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_new integer not null default 0 check (records_new >= 0),
  records_changed integer not null default 0 check (records_changed >= 0),
  records_unchanged integer not null default 0 check (records_unchanged >= 0),
  records_reviewed integer not null default 0 check (records_reviewed >= 0),
  records_closed_candidates integer not null default 0 check (records_closed_candidates >= 0),
  payload_count integer not null default 0 check (payload_count >= 0),
  error_class text check (error_class is null or error_class in ('network','timeout','robots','auth','schema','rate_limit','unexpected')),
  error_message text,
  log_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint source_fetch_runs_finished_after_started check (
    finished_at is null or started_at is null or finished_at >= started_at
  )
);

create table if not exists source_payloads (
  id uuid primary key default gen_random_uuid(),
  source_fetch_run_id uuid not null references source_fetch_runs(id) on delete cascade,
  request_url text not null,
  final_url text,
  content_type text,
  etag text,
  last_modified text,
  status_code integer,
  sha256 text not null,
  size_bytes integer not null check (size_bytes >= 0),
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table if not exists source_postings (
  id uuid primary key default gen_random_uuid(),
  job_source_id uuid not null references job_sources(id) on delete restrict,
  external_posting_id text,
  canonical_url text not null,
  identity_key text not null,
  employer_name_raw text,
  employer_name_normalized text,
  title_normalized text,
  location_normalized text,
  remote_type text check (remote_type is null or remote_type in ('remote','hybrid','onsite','unknown')),
  employment_type text,
  classification text check (classification is null or classification in ('internship','entry_level','fellowship','research','other')),
  department text,
  focus_area text,
  posted_at date,
  closes_at date,
  deadline_kind text check (deadline_kind is null or deadline_kind in ('hard','rolling','unknown')),
  current_status text not null default 'open' check (current_status in ('open','missing','closure_candidate','closed','reopened','unknown')),
  relevance_score integer,
  relevance_score_version text,
  score_breakdown_json jsonb not null default '{}'::jsonb,
  uncertainty_flags text[] not null default '{}',
  closure_confidence numeric(5,4) not null default 0 check (closure_confidence >= 0 and closure_confidence <= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_payload_id uuid references source_payloads(id) on delete set null,
  last_material_hash text not null,
  consecutive_misses integer not null default 0 check (consecutive_misses >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_postings_seen_window_valid check (last_seen_at >= first_seen_at),
  constraint source_postings_closes_after_posted check (
    closes_at is null or posted_at is null or closes_at >= posted_at
  )
);

create table if not exists source_posting_versions (
  id uuid primary key default gen_random_uuid(),
  source_posting_id uuid not null references source_postings(id) on delete cascade,
  source_fetch_run_id uuid not null references source_fetch_runs(id) on delete restrict,
  source_payload_id uuid not null references source_payloads(id) on delete restrict,
  connector_version text not null,
  is_material_change boolean not null,
  material_hash text not null,
  normalized_json jsonb not null,
  score_breakdown_json jsonb not null default '{}'::jsonb,
  field_diff_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists opportunity_source_links (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete restrict,
  source_posting_id uuid not null references source_postings(id) on delete restrict,
  match_type text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (opportunity_id, source_posting_id)
);

create index if not exists idx_job_sources_enabled_priority on job_sources(enabled, priority);
create index if not exists idx_job_sources_enabled_interval on job_sources(enabled, fetch_interval_hours);
create index if not exists idx_job_sources_company_id on job_sources(company_id);
create index if not exists idx_job_sources_paused_at on job_sources(automatic_scheduling_paused_at);

create index if not exists idx_source_fetch_runs_job_source_scheduled_desc on source_fetch_runs(job_source_id, scheduled_for desc);
create index if not exists idx_source_fetch_runs_status_scheduled_for on source_fetch_runs(status, scheduled_for);
create index if not exists idx_source_fetch_runs_pending_running on source_fetch_runs(scheduled_for)
  where status in ('pending', 'running');

create unique index if not exists idx_source_payloads_run_sha_request on source_payloads(source_fetch_run_id, sha256, request_url);
create index if not exists idx_source_payloads_run_id on source_payloads(source_fetch_run_id);

create unique index if not exists idx_source_postings_source_identity on source_postings(job_source_id, identity_key);
create index if not exists idx_source_postings_source_status on source_postings(job_source_id, current_status);
create index if not exists idx_source_postings_last_seen_at on source_postings(last_seen_at);
create index if not exists idx_source_postings_closes_at on source_postings(closes_at);

create index if not exists idx_source_posting_versions_posting_created_desc on source_posting_versions(source_posting_id, created_at desc);
create index if not exists idx_source_posting_versions_material_hash on source_posting_versions(material_hash);

create unique index if not exists idx_opportunity_source_links_primary_per_opportunity
  on opportunity_source_links(opportunity_id)
  where is_primary;

create or replace function claim_source_fetch_runs(p_worker_id text, p_limit integer default 1)
returns setof source_fetch_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select sfr.id
    from source_fetch_runs sfr
    join job_sources js on js.id = sfr.job_source_id
    where sfr.status = 'pending'
      and sfr.scheduled_for <= now()
      and js.enabled
      and js.automatic_scheduling_paused_at is null
    order by js.priority asc, sfr.scheduled_for asc, sfr.created_at asc
    for update of sfr skip locked
    limit greatest(coalesce(p_limit, 1), 1)
  )
  update source_fetch_runs sfr
     set status = 'running',
         started_at = coalesce(sfr.started_at, now()),
         worker_id = p_worker_id
    from claimed
   where sfr.id = claimed.id
  returning sfr.*;
end;
$$;

grant execute on function claim_source_fetch_runs(text, integer) to service_role;

create or replace function prevent_source_posting_versions_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'source_posting_versions is append-only';
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_source_posting_versions_append_only'
  ) then
    create trigger trg_source_posting_versions_append_only
      before update or delete on source_posting_versions
      for each row
      execute function prevent_source_posting_versions_mutation();
  end if;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array['job_sources','source_postings'] loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = format('trg_%s_updated', t)
    ) then
      execute format('create trigger trg_%s_updated before update on %I
        for each row execute function set_updated_at()', t, t);
    end if;
  end loop;
end
$$;

do $$
declare
  t text;
  p text;
begin
  foreach t in array array['job_sources','source_fetch_runs','source_payloads','source_postings','source_posting_versions','opportunity_source_links'] loop
    execute format('alter table %I enable row level security', t);
    p := format('officer_all_%s', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = p
    ) then
      execute format('create policy %I on %I for all
        using (is_officer()) with check (is_officer())', p, t);
    end if;
  end loop;
end
$$;

grant all on table job_sources, source_fetch_runs, source_payloads,
  source_postings, source_posting_versions, opportunity_source_links to service_role;

insert into storage.buckets (id, name, public)
values ('source-payloads', 'source-payloads', false)
on conflict (id) do update
set public = excluded.public,
    name = excluded.name;

alter table storage.objects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_select_source_payloads'
  ) then
    create policy officer_select_source_payloads on storage.objects
      for select to authenticated
      using (bucket_id = 'source-payloads' and public.is_officer());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_insert_source_payloads'
  ) then
    create policy officer_insert_source_payloads on storage.objects
      for insert to authenticated
      with check (bucket_id = 'source-payloads' and public.is_officer());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_update_source_payloads'
  ) then
    create policy officer_update_source_payloads on storage.objects
      for update to authenticated
      using (bucket_id = 'source-payloads' and public.is_officer())
      with check (bucket_id = 'source-payloads' and public.is_officer());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'officer_delete_source_payloads'
  ) then
    create policy officer_delete_source_payloads on storage.objects
      for delete to authenticated
      using (bucket_id = 'source-payloads' and public.is_officer());
  end if;
end
$$;
