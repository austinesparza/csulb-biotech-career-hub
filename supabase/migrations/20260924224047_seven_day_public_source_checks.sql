-- Align public-source follow-up with the seven-day freshness guard used for reviewed publication.
-- Only queues private officer tasks; never changes the public status automatically.

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
    'Public opportunity has not been source-checked in seven days. Recheck the employer posting and application link.'
  from public.opportunities o
  where o.review_status = 'approved'
    and o.public_safe
    and o.status in ('open_verified', 'open_unverified')
    and (o.last_checked_at is null or o.last_checked_at <= now() - interval '7 days')
  on conflict do nothing;
  get diagnostics v_stale_records = row_count;

  return query select v_source_health, v_stale_records;
end;
$$;

revoke execute on function public.queue_pipeline_health_tasks() from public, anon, authenticated;
grant execute on function public.queue_pipeline_health_tasks() to service_role;

comment on function public.queue_pipeline_health_tasks() is
  'Creates deduplicated officer tasks for unhealthy sources and public records not checked in seven days. Does not publish.';
