-- Official-posting verification archive.
--
-- One append-only row per verification attempt of a candidate employer
-- requisition URL (from discovery leads or private source research). A row
-- records what was observed, under which governed source (if any) a fetch was
-- allowed, the redirect chain, HTTP state, content hash, a private snapshot
-- reference, the identity comparison, duplicate decision, and every hard gate
-- with its verbatim evidence or an explicit unknown.
--
-- Only a `review_candidate` outcome creates a private officer task. Closed,
-- duplicate, rejected and unresolved findings are retained for recall
-- analysis. Nothing here approves, publishes, or edits an opportunity.
--
-- Apply AFTER 20260926120000_discovery_review_candidate_gate.sql.

create table if not exists public.posting_verifications (
  id                     uuid primary key default gen_random_uuid(),
  verification_key       text not null unique check (verification_key ~ '^[0-9a-f]{64}$'),
  run_id                 text not null check (trim(run_id) <> '' and length(run_id) <= 160),
  identity_key           text check (identity_key is null or length(identity_key) <= 500),
  observed_url           text not null check (trim(observed_url) <> '' and length(observed_url) <= 2000),
  canonical_url          text check (canonical_url is null or length(canonical_url) <= 2000),
  final_url              text check (final_url is null or length(final_url) <= 2000),
  redirect_chain         jsonb not null default '[]'::jsonb check (jsonb_typeof(redirect_chain) = 'array'),
  http_status            integer check (http_status is null or (http_status >= 100 and http_status <= 599)),
  content_type           text check (content_type is null or length(content_type) <= 200),
  retrieved_at           timestamptz,
  content_sha256         text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_storage_path  text check (snapshot_storage_path is null or snapshot_storage_path like 'verification/%'),
  source_payload_id      uuid references public.source_payloads(id) on delete set null,
  source_posting_id      uuid references public.source_postings(id) on delete set null,
  job_source_id          uuid references public.job_sources(id) on delete set null,
  governance_status      text not null check (governance_status in (
                           'fetched', 'feed_record', 'no_governed_source', 'source_policy_blocked', 'not_required'
                         )),
  governance_reason      text check (governance_reason is null or length(governance_reason) <= 1000),
  discovery_lead_id      uuid references public.discovery_leads(id) on delete set null,
  user_submission_id     uuid references public.user_submissions(id) on delete set null,
  lead_employer          text check (lead_employer is null or length(lead_employer) <= 500),
  lead_title             text check (lead_title is null or length(lead_title) <= 500),
  lead_first_seen_at     timestamptz,
  ats_system             text not null check (length(ats_system) <= 40),
  tenant_key             text check (tenant_key is null or length(tenant_key) <= 500),
  requisition_id         text check (requisition_id is null or length(requisition_id) <= 200),
  page_state             text not null check (page_state in (
                           'apply_visible', 'closed', 'removed', 'expired', 'blocked', 'script_only',
                           'error_page', 'redirected_away', 'requisition_conflict', 'fetch_error',
                           'ambiguous', 'not_fetched'
                         )),
  page_title             text check (page_title is null or length(page_title) <= 500),
  outcome                text not null check (outcome in (
                           'review_candidate', 'duplicate_existing', 'repeat_candidate', 'closed',
                           'gate_excluded', 'rejected_attribution', 'rejected_title_mismatch',
                           'rejected_not_requisition', 'unresolved_governance', 'unresolved_page',
                           'unresolved_attribution', 'unresolved_conflict'
                         )),
  reasons                text[] not null default '{}',
  comparison             jsonb not null default '{}'::jsonb check (jsonb_typeof(comparison) = 'object'),
  duplicates             jsonb not null default '{}'::jsonb check (jsonb_typeof(duplicates) = 'object'),
  gates                  jsonb not null default '{}'::jsonb check (jsonb_typeof(gates) = 'object'),
  created_at             timestamptz not null default now(),
  -- A fetched row must carry the evidence needed to re-derive its decision.
  constraint posting_verifications_fetched_evidence check (
    governance_status <> 'fetched'
    or retrieved_at is not null
  ),
  -- Apply visibility is only ever recorded from a stored, hashed snapshot.
  constraint posting_verifications_apply_requires_snapshot check (
    page_state <> 'apply_visible'
    or (content_sha256 is not null and (snapshot_storage_path is not null or source_payload_id is not null))
  ),
  -- A review candidate always names an individual requisition.
  constraint posting_verifications_candidate_identity check (
    outcome <> 'review_candidate' or (identity_key is not null and page_state = 'apply_visible')
  )
);

create index if not exists idx_posting_verifications_identity
  on public.posting_verifications(identity_key, created_at desc);
create index if not exists idx_posting_verifications_outcome
  on public.posting_verifications(outcome, created_at desc);
create index if not exists idx_posting_verifications_lead
  on public.posting_verifications(discovery_lead_id) where discovery_lead_id is not null;
create index if not exists idx_posting_verifications_submission
  on public.posting_verifications(user_submission_id) where user_submission_id is not null;
create index if not exists idx_posting_verifications_payload
  on public.posting_verifications(source_payload_id) where source_payload_id is not null;
create index if not exists idx_posting_verifications_posting
  on public.posting_verifications(source_posting_id) where source_posting_id is not null;
create index if not exists idx_posting_verifications_source
  on public.posting_verifications(job_source_id) where job_source_id is not null;

-- Evidence is immutable. A new observation is a new row.
create or replace function public.posting_verifications_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'posting_verifications is append-only; record a new verification instead';
end;
$$;

drop trigger if exists trg_posting_verifications_append_only on public.posting_verifications;
create trigger trg_posting_verifications_append_only
  before update or delete on public.posting_verifications
  for each row execute function public.posting_verifications_append_only();

alter table public.posting_verifications enable row level security;
revoke all on public.posting_verifications from public, anon, authenticated, service_role;
grant select on public.posting_verifications to authenticated;
grant select, insert on public.posting_verifications to service_role;

drop policy if exists officer_select_posting_verifications on public.posting_verifications;
create policy officer_select_posting_verifications
  on public.posting_verifications for select to authenticated
  using (public.is_officer());

-- Records one verification and, only for a distinct review candidate, one
-- private officer task. Idempotent on verification_key. A second candidate for
-- the same requisition does not open a second task while one is open.
create or replace function public.record_posting_verification(p_row jsonb)
returns table (verification_id uuid, review_task_id uuid, created boolean)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_task uuid;
  v_created boolean := false;
  v_outcome text := p_row->>'outcome';
  v_identity text := nullif(p_row->>'identity_key', '');
begin
  if jsonb_typeof(p_row) <> 'object' then
    raise exception 'verification row must be an object';
  end if;

  insert into public.posting_verifications (
    verification_key, run_id, identity_key, observed_url, canonical_url, final_url, redirect_chain,
    http_status, content_type, retrieved_at, content_sha256, snapshot_storage_path, source_payload_id,
    source_posting_id, job_source_id, governance_status, governance_reason, discovery_lead_id,
    user_submission_id, lead_employer, lead_title, lead_first_seen_at, ats_system, tenant_key,
    requisition_id, page_state, page_title, outcome, reasons, comparison, duplicates, gates
  ) values (
    p_row->>'verification_key', p_row->>'run_id', v_identity, p_row->>'observed_url',
    nullif(p_row->>'canonical_url', ''), nullif(p_row->>'final_url', ''),
    coalesce(p_row->'redirect_chain', '[]'::jsonb), (p_row->>'http_status')::integer,
    nullif(p_row->>'content_type', ''), (p_row->>'retrieved_at')::timestamptz,
    nullif(p_row->>'content_sha256', ''), nullif(p_row->>'snapshot_storage_path', ''),
    (p_row->>'source_payload_id')::uuid, (p_row->>'source_posting_id')::uuid, (p_row->>'job_source_id')::uuid,
    p_row->>'governance_status', nullif(p_row->>'governance_reason', ''),
    (p_row->>'discovery_lead_id')::uuid, (p_row->>'user_submission_id')::uuid,
    nullif(p_row->>'lead_employer', ''), nullif(p_row->>'lead_title', ''),
    (p_row->>'lead_first_seen_at')::timestamptz, p_row->>'ats_system', nullif(p_row->>'tenant_key', ''),
    nullif(p_row->>'requisition_id', ''), p_row->>'page_state', nullif(p_row->>'page_title', ''), v_outcome,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_row->'reasons', '[]'::jsonb))), '{}'),
    coalesce(p_row->'comparison', '{}'::jsonb), coalesce(p_row->'duplicates', '{}'::jsonb),
    coalesce(p_row->'gates', '{}'::jsonb)
  )
  on conflict (verification_key) do nothing
  returning id into v_id;

  v_created := v_id is not null;
  if not v_created then
    select pv.id into v_id from public.posting_verifications pv
    where pv.verification_key = p_row->>'verification_key';
  end if;

  if v_created and v_outcome = 'review_candidate' and v_identity is not null then
    -- Different leads for the same requisition can be processed concurrently.
    -- Serialize the existence check and insertion for this identity.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_identity, 0));
  end if;

  if v_created and v_outcome = 'review_candidate' and v_identity is not null
     and not exists (
       select 1
       from public.review_tasks rt
       join public.posting_verifications other on other.id = rt.entity_id
       where rt.entity_table = 'posting_verifications'
         and rt.status in ('open', 'in_progress')
         and other.identity_key = v_identity
     ) then
    insert into public.review_tasks(task_type, entity_table, entity_id, status, priority, notes)
    values (
      'source_new', 'posting_verifications', v_id, 'open',
      greatest(1, least(coalesce((p_row->>'review_priority')::integer, 60), 100)),
      left(coalesce(nullif(trim(p_row->>'task_notes'), ''), 'Verified employer requisition awaiting officer review'), 2000)
    )
    on conflict do nothing
    returning id into v_task;
  end if;

  return query select v_id, v_task, v_created;
end;
$$;

revoke execute on function public.record_posting_verification(jsonb) from public, anon, authenticated;
grant execute on function public.record_posting_verification(jsonb) to service_role;

-- A source registered only to scope requisition verification (for example a
-- Workday or iCIMS tenant with no feed connector) must not be list-fetched by
-- the scheduler. Everything else in the scheduler is unchanged from
-- 20260912051000_schedule_new_sources_immediately.sql.
create or replace function public.schedule_due_source_fetch_runs(
  p_limit integer default 5
)
returns setof uuid
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then
    raise exception 'schedule_due_source_fetch_runs: p_limit must be between 1 and 10';
  end if;

  return query
  with due as (
    select js.id
    from public.job_sources js
    where js.enabled
      and js.terms_reviewed
      and js.terms_review_date is not null
      and js.robots_reviewed
      and js.automatic_scheduling_paused_at is null
      and coalesce(js.config_json -> 'requisition_verification' ->> 'verification_only', 'false') <> 'true'
      and (
        js.last_attempted_at is null
        or js.last_attempted_at <= now() - make_interval(hours => js.fetch_interval_hours)
      )
      and not exists (
        select 1
        from public.source_fetch_runs active_run
        where active_run.job_source_id = js.id
          and active_run.status in ('pending', 'running')
      )
    order by js.priority, js.last_attempted_at nulls first, js.id
    for update of js skip locked
    limit p_limit
  )
  insert into public.source_fetch_runs(job_source_id, trigger_kind, status, scheduled_for)
  select due.id, 'scheduled', 'pending', now()
  from due
  returning source_fetch_runs.id;
end;
$$;

revoke execute on function public.schedule_due_source_fetch_runs(integer) from public, anon, authenticated;
grant execute on function public.schedule_due_source_fetch_runs(integer) to service_role;

comment on table public.posting_verifications is
  'Private, append-only verification evidence for candidate employer requisitions. Never publication authority.';
comment on function public.record_posting_verification(jsonb) is
  'Service-only: archive one verification; opens a private source_new task only for a distinct review candidate.';
