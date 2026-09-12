-- Bootstrap newly enabled governed sources on the next ingestion cycle.
--
-- A source with no prior attempt is due immediately. Subsequent attempts keep
-- the configured interval. Active pending/running runs still prevent duplicate
-- queue entries, so repeated cron invocations remain idempotent.

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

comment on function public.schedule_due_source_fetch_runs(integer) is
  'Queues each governed source immediately before its first fetch, then at its configured interval; active runs prevent duplicates.';
