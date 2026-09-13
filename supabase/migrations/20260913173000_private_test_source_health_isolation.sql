-- Private source validation must not advance production scheduling health.
--
-- Private tests intentionally archive evidence and exercise persistence, but they
-- are not production polling attempts. The application runner already skips its
-- explicit source-health write for private tests; this keeps the database trigger
-- consistent with that contract as well.

create or replace function public.update_job_source_health_from_fetch_run()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if lower(coalesce(new.log_json->>'privateTest', 'false')) = 'true' then
    return new;
  end if;

  if new.status = 'running' then
    update public.job_sources js
       set last_attempted_at = coalesce(new.started_at, now())
     where js.id = new.job_source_id;
  elsif new.status in ('completed', 'partial', 'failed') then
    update public.job_sources js
       set last_attempted_at = coalesce(new.started_at, new.finished_at, now()),
           last_successful_at = case
             when new.status in ('completed', 'partial') then coalesce(new.finished_at, now())
             else js.last_successful_at
           end,
           consecutive_failures = case
             when new.status = 'failed' then js.consecutive_failures + 1
             else 0
           end,
           last_http_status = new.http_status,
           degraded_at = case
             when new.status in ('completed', 'partial') then null
             when new.status = 'failed' and js.consecutive_failures + 1 >= 3
               then coalesce(js.degraded_at, new.finished_at, now())
             else js.degraded_at
           end
     where js.id = new.job_source_id;

    if new.status = 'failed' and exists (
      select 1
      from public.job_sources js
      where js.id = new.job_source_id
        and js.consecutive_failures >= 3
    ) then
      insert into public.review_tasks (task_type, entity_table, entity_id, status, notes)
      values (
        'source_health',
        'job_sources',
        new.job_source_id,
        'open',
        '[source_health] Source has failed three or more consecutive fetches.'
      )
      on conflict (task_type, entity_table, entity_id, notes)
      where status = 'open'
      do nothing;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.update_job_source_health_from_fetch_run() is
  'Updates production source health on real fetch state changes while ignoring governed private-test runs.';
