-- Pipeline-cycle observability and worker self-healing.
-- Additive only: no automatic publication behavior is introduced.

create table if not exists public.pipeline_cycles (
  id                    uuid primary key default gen_random_uuid(),
  trigger_kind          text not null check (trigger_kind in ('cron','officer','queue_recovery','sheet_sync')),
  status                text not null default 'running' check (status in ('running','completed','partial','failed')),
  worker_id             text not null check (trim(worker_id) <> ''),
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  scheduled_count       integer not null default 0 check (scheduled_count >= 0),
  recovered_count       integer not null default 0 check (recovered_count >= 0),
  claimed_count         integer not null default 0 check (claimed_count >= 0),
  completed_count       integer not null default 0 check (completed_count >= 0),
  failed_count          integer not null default 0 check (failed_count >= 0),
  records_seen          integer not null default 0 check (records_seen >= 0),
  records_archived      integer not null default 0 check (records_archived >= 0),
  review_tasks_created  integer not null default 0 check (review_tasks_created >= 0),
  reconciliation_json   jsonb not null default '{}'::jsonb,
  discovery_json        jsonb not null default '{}'::jsonb,
  extraction_json       jsonb not null default '{}'::jsonb,
  sheet_sync_json       jsonb not null default '{}'::jsonb,
  errors_json           jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  constraint pipeline_cycles_finished_requires_terminal_status check (
    finished_at is null or status <> 'running'
  ),
  constraint pipeline_cycles_finish_after_start check (
    finished_at is null or finished_at >= started_at
  )
);

create index if not exists idx_pipeline_cycles_started_desc
  on public.pipeline_cycles(started_at desc);
create index if not exists idx_pipeline_cycles_status_started
  on public.pipeline_cycles(status, started_at desc);

-- These two foreign-key paths are hot in source reconciliation and Sheet sync.
create index if not exists idx_opportunity_source_links_source_posting_id
  on public.opportunity_source_links(source_posting_id);
create index if not exists idx_opportunities_source_record_id
  on public.opportunities(source_record_id);

-- Enforce the queue invariant that one source cannot have two active fetch runs.
create unique index if not exists idx_source_fetch_runs_one_active_per_source
  on public.source_fetch_runs(job_source_id)
  where status in ('pending','running');

alter table public.pipeline_cycles enable row level security;

revoke all on public.pipeline_cycles from public, anon, authenticated;
grant select, insert, update on public.pipeline_cycles to service_role;
grant select on public.pipeline_cycles to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'pipeline_cycles'
      and policyname = 'officer_select_pipeline_cycles'
  ) then
    create policy officer_select_pipeline_cycles
      on public.pipeline_cycles
      for select
      to authenticated
      using (public.is_officer());
  end if;
end
$$;

-- Convert abandoned running work into an explicit failed attempt. Requeue only
-- when the source is still enabled and resumed. Paused or disabled sources are
-- finalized instead of being left permanently in a running state.
create or replace function public.recover_stale_source_fetch_runs(
  p_stale_after_minutes integer default 20,
  p_limit integer default 20
)
returns setof uuid
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_stale_after_minutes is null or p_stale_after_minutes < 5 or p_stale_after_minutes > 1440 then
    raise exception 'recover_stale_source_fetch_runs: stale timeout must be between 5 and 1440 minutes';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'recover_stale_source_fetch_runs: p_limit must be between 1 and 50';
  end if;

  return query
  with stale as (
    select
      sfr.id,
      sfr.job_source_id,
      sfr.attempt_no,
      sfr.worker_id,
      js.enabled,
      js.automatic_scheduling_paused_at
    from public.source_fetch_runs sfr
    join public.job_sources js on js.id = sfr.job_source_id
    where sfr.status = 'running'
      and sfr.started_at is not null
      and sfr.started_at <= now() - make_interval(mins => p_stale_after_minutes)
    order by sfr.started_at asc, sfr.created_at asc
    for update of sfr skip locked
    limit p_limit
  ), failed as (
    update public.source_fetch_runs sfr
       set status = 'failed',
           finished_at = now(),
           error_class = 'timeout',
           error_message = case
             when stale.enabled and stale.automatic_scheduling_paused_at is null
               then 'Worker lease expired before the run was finalized; a retry was queued.'
             else 'Worker lease expired before the run was finalized; source is disabled or paused, so no retry was queued.'
           end,
           log_json = coalesce(sfr.log_json, '{}'::jsonb) || jsonb_build_object(
             'staleWorkerRecoveredAt', now(),
             'staleWorkerId', stale.worker_id,
             'retryEligible', stale.enabled and stale.automatic_scheduling_paused_at is null
           )
      from stale
     where sfr.id = stale.id
    returning
      sfr.id,
      sfr.job_source_id,
      sfr.attempt_no,
      stale.enabled,
      stale.automatic_scheduling_paused_at
  ), retries as (
    insert into public.source_fetch_runs(
      job_source_id,
      trigger_kind,
      status,
      scheduled_for,
      attempt_no,
      log_json
    )
    select
      failed.job_source_id,
      'retry',
      'pending',
      now(),
      failed.attempt_no + 1,
      jsonb_build_object('retryOfStaleRun', failed.id)
    from failed
    where failed.enabled
      and failed.automatic_scheduling_paused_at is null
    on conflict do nothing
    returning id
  )
  select retries.id from retries;
end;
$$;

revoke execute on function public.recover_stale_source_fetch_runs(integer, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_source_fetch_runs(integer, integer) to service_role;

comment on table public.pipeline_cycles is
  'One observable end-to-end private ingestion cycle. Cycle records never authorize publication.';
comment on function public.recover_stale_source_fetch_runs(integer, integer) is
  'Finalizes abandoned running source fetches and queues at most one retry per enabled, resumed source. Service-role only.';
