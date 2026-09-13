\set ON_ERROR_STOP on

begin;

create temp table _pipeline_recovery_results (
  check_name text primary key,
  passed boolean not null
) on commit drop;

do $$
declare
  v_source_record_id uuid;
  v_source_id uuid;
  v_stale_run_id uuid;
  v_recovered_run_id uuid;
  v_retry_run_id uuid;
  v_second_recovery_id uuid;
  v_paused_source_record_id uuid;
  v_paused_source_id uuid;
  v_paused_stale_run_id uuid;
  v_paused_recovered_run_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('pipeline-recovery-active-source', 'website_page')
  returning id into v_source_record_id;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, source_identifier, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed,
    fetch_interval_hours, priority
  ) values (
    v_source_record_id, 'Pipeline Recovery Active Source', 'greenhouse', 'pipeline-recovery-active',
    'https://job-boards.greenhouse.io/pipeline-recovery-active',
    true, true, current_date, true, 24, 1
  ) returning id into v_source_id;

  insert into public.source_fetch_runs (
    job_source_id, trigger_kind, status, scheduled_for, started_at, worker_id, attempt_no
  ) values (
    v_source_id, 'manual', 'running', now() - interval '30 minutes',
    now() - interval '30 minutes', 'stale-worker', 2
  ) returning id into v_stale_run_id;

  select * into v_recovered_run_id
  from public.recover_stale_source_fetch_runs(20, 10);

  insert into _pipeline_recovery_results values (
    'recovery returns the finalized stale run id',
    v_recovered_run_id = v_stale_run_id
  );

  insert into _pipeline_recovery_results values (
    'stale running fetch is finalized as timeout failure',
    exists (
      select 1
      from public.source_fetch_runs
      where id = v_stale_run_id
        and status = 'failed'
        and error_class = 'timeout'
        and finished_at is not null
    )
  );

  select id into v_retry_run_id
  from public.source_fetch_runs
  where job_source_id = v_source_id
    and status = 'pending'
    and trigger_kind = 'retry';

  insert into _pipeline_recovery_results values (
    'eligible stale fetch queues exactly one retry',
    v_retry_run_id is not null
      and (
        select count(*) = 1
        from public.source_fetch_runs
        where job_source_id = v_source_id
          and status in ('pending', 'running')
      )
      and exists (
        select 1
        from public.source_fetch_runs
        where id = v_retry_run_id
          and attempt_no = 3
          and log_json ->> 'retryOfStaleRun' = v_stale_run_id::text
      )
  );

  select * into v_second_recovery_id
  from public.recover_stale_source_fetch_runs(20, 10);

  insert into _pipeline_recovery_results values (
    'recovery is idempotent when no stale running work remains',
    v_second_recovery_id is null
  );

  insert into public.source_records (name, source_type)
  values ('pipeline-recovery-paused-source', 'website_page')
  returning id into v_paused_source_record_id;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, source_identifier, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed,
    fetch_interval_hours, priority, automatic_scheduling_paused_at
  ) values (
    v_paused_source_record_id, 'Pipeline Recovery Paused Source', 'greenhouse', 'pipeline-recovery-paused',
    'https://job-boards.greenhouse.io/pipeline-recovery-paused',
    true, true, current_date, true, 24, 1, now()
  ) returning id into v_paused_source_id;

  insert into public.source_fetch_runs (
    job_source_id, trigger_kind, status, scheduled_for, started_at, worker_id, attempt_no
  ) values (
    v_paused_source_id, 'manual', 'running', now() - interval '30 minutes',
    now() - interval '30 minutes', 'stale-paused-worker', 1
  ) returning id into v_paused_stale_run_id;

  select * into v_paused_recovered_run_id
  from public.recover_stale_source_fetch_runs(20, 10);

  insert into _pipeline_recovery_results values (
    'paused source stale work is still finalized',
    v_paused_recovered_run_id = v_paused_stale_run_id
      and exists (
        select 1
        from public.source_fetch_runs
        where id = v_paused_stale_run_id
          and status = 'failed'
          and error_class = 'timeout'
      )
  );

  insert into _pipeline_recovery_results values (
    'paused source does not receive an automatic retry',
    not exists (
      select 1
      from public.source_fetch_runs
      where job_source_id = v_paused_source_id
        and status in ('pending', 'running')
    )
  );

  insert into _pipeline_recovery_results values (
    'pipeline cycle observability table and officer policy exist',
    to_regclass('public.pipeline_cycles') is not null
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'pipeline_cycles'
          and policyname = 'officer_select_pipeline_cycles'
      )
  );

  insert into _pipeline_recovery_results values (
    'single active fetch index exists',
    exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'idx_source_fetch_runs_one_active_per_source'
    )
  );

  if exists (select 1 from _pipeline_recovery_results where not passed) then
    raise exception 'Pipeline recovery contract failed: %',
      (select string_agg(check_name, ', ') from _pipeline_recovery_results where not passed);
  end if;
end
$$;

rollback;
