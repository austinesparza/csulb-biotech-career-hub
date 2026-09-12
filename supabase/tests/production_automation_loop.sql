\set ON_ERROR_STOP on

begin;

create temp table _automation_results (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_source_record_id uuid;
  v_source_id uuid;
  v_first_run_id uuid;
  v_duplicate_run_id uuid;
  v_after_success_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('automation-bootstrap-test', 'website_page')
  returning id into v_source_record_id;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, source_identifier, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed,
    fetch_interval_hours, priority
  ) values (
    v_source_record_id, 'Automation Bootstrap Test', 'greenhouse', 'bootstrap-test',
    'https://job-boards.greenhouse.io/bootstrap-test',
    true, true, current_date, true, 24, 1
  ) returning id into v_source_id;

  select * into v_first_run_id
  from public.schedule_due_source_fetch_runs(1);

  insert into _automation_results values (
    'never-attempted governed source is scheduled immediately',
    v_first_run_id is not null
      and exists (
        select 1 from public.source_fetch_runs
        where id = v_first_run_id
          and job_source_id = v_source_id
          and status = 'pending'
          and trigger_kind = 'scheduled'
      )
  );

  select * into v_duplicate_run_id
  from public.schedule_due_source_fetch_runs(1);

  insert into _automation_results values (
    'active run prevents duplicate scheduling',
    v_duplicate_run_id is null
  );

  update public.source_fetch_runs
  set status = 'completed', started_at = now(), finished_at = now()
  where id = v_first_run_id;

  update public.job_sources
  set last_attempted_at = now(), last_successful_at = now()
  where id = v_source_id;

  select * into v_after_success_id
  from public.schedule_due_source_fetch_runs(1);

  insert into _automation_results values (
    'recently attempted source waits for configured interval',
    v_after_success_id is null
  );

  if exists (select 1 from _automation_results where not passed) then
    raise exception 'Production automation loop contract failed: %',
      (select string_agg(check_name, ', ') from _automation_results where not passed);
  end if;
end
$$;

rollback;
