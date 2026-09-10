-- Production scheduling and health review loop.
-- These functions are service-role only. They queue private work and cannot publish.

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
      and coalesce(js.last_attempted_at, js.created_at)
          <= now() - make_interval(hours => js.fetch_interval_hours)
      and not exists (
        select 1
        from public.source_fetch_runs active_run
        where active_run.job_source_id = js.id
          and active_run.status in ('pending', 'running')
      )
    order by js.priority, coalesce(js.last_attempted_at, js.created_at), js.id
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

create or replace function public.queue_pipeline_health_tasks()
returns table(source_health_tasks integer, stale_record_tasks integer)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_source_health integer := 0;
  v_stale_records integer := 0;
begin
  insert into public.review_tasks(task_type, entity_table, entity_id, status, priority, due_date, notes)
  select
    'source_health',
    'job_sources',
    js.id,
    'open',
    40,
    current_date,
    case
      when js.automatic_scheduling_paused_at is not null then 'Automated source is paused. Review before resuming.'
      when js.consecutive_failures >= 3 then 'Automated source has failed at least three consecutive times.'
      when js.last_successful_at is null then 'Enabled source has not completed a successful fetch.'
      else 'Automated source is stale relative to its configured interval.'
    end
  from public.job_sources js
  where js.enabled
    and (
      js.automatic_scheduling_paused_at is not null
      or js.consecutive_failures >= 3
      or js.last_successful_at is null
      or js.last_successful_at <= now() - make_interval(hours => js.fetch_interval_hours * 2)
    )
  on conflict do nothing;
  get diagnostics v_source_health = row_count;

  insert into public.review_tasks(task_type, entity_table, entity_id, status, priority, due_date, notes)
  select
    'stale_record',
    'opportunities',
    o.id,
    'open',
    60,
    current_date,
    'Public opportunity has not been source-checked in 14 days.'
  from public.opportunities o
  where o.review_status = 'approved'
    and o.public_safe
    and o.status in ('open_verified', 'open_unverified')
    and coalesce(o.last_checked_at, o.first_seen_at) <= now() - interval '14 days'
  on conflict do nothing;
  get diagnostics v_stale_records = row_count;

  return query select v_source_health, v_stale_records;
end;
$$;

revoke execute on function public.queue_pipeline_health_tasks() from public, anon, authenticated;
grant execute on function public.queue_pipeline_health_tasks() to service_role;
