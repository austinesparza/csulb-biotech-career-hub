\set ON_ERROR_STOP on

-- Contract: posting_verifications is private, append-only evidence; only a
-- distinct review candidate opens one officer task; retries are idempotent.
begin;

do $$
declare
  v_row jsonb := jsonb_build_object(
    'verification_key', repeat('a', 64),
    'run_id', 'contract-run',
    'identity_key', 'jnj:www.careers.jnj.com:r-099898',
    'observed_url', 'https://www.careers.jnj.com/en/jobs/r-099898/oncology-discovery-scientist-intern/',
    'canonical_url', 'https://www.careers.jnj.com/en/jobs/r-099898/oncology-discovery-scientist-intern',
    'final_url', 'https://www.careers.jnj.com/en/jobs/r-099898/oncology-discovery-scientist-intern',
    'redirect_chain', '[]'::jsonb,
    'http_status', 200,
    'content_type', 'text/html',
    'retrieved_at', '2026-09-26T16:00:00Z',
    'content_sha256', repeat('b', 64),
    'snapshot_storage_path', 'verification/src/2026-09-26/' || repeat('b', 64) || '.txt',
    'governance_status', 'fetched',
    'ats_system', 'jnj',
    'tenant_key', 'www.careers.jnj.com',
    'requisition_id', 'R-099898',
    'page_state', 'apply_visible',
    'page_title', 'Oncology Discovery Scientist Intern',
    'outcome', 'review_candidate',
    'reasons', '["Apply control visible"]'::jsonb,
    'gates', '{"degreeLevel":{"value":"graduate_accepted","quote":"Master''s or PhD"}}'::jsonb,
    'review_priority', 25,
    'task_notes', 'Verified employer requisition: Johnson & Johnson (R-099898)'
  );
  v_first record;
  v_retry record;
  v_second record;
  v_closed record;
  v_tasks integer;
begin
  select * into v_first from public.record_posting_verification(v_row);
  if not v_first.created or v_first.review_task_id is null then
    raise exception 'review candidate did not create an officer task';
  end if;
  if not exists (
    select 1 from public.review_tasks
    where id = v_first.review_task_id and task_type = 'source_new'
      and entity_table = 'posting_verifications' and entity_id = v_first.verification_id
      and status = 'open' and priority = 25
  ) then
    raise exception 'officer task has the wrong shape';
  end if;

  select * into v_retry from public.record_posting_verification(v_row);
  if v_retry.created or v_retry.review_task_id is not null or v_retry.verification_id <> v_first.verification_id then
    raise exception 'retry of the same verification was not idempotent';
  end if;

  select * into v_second from public.record_posting_verification(
    v_row || jsonb_build_object('verification_key', repeat('c', 64), 'run_id', 'next-day'));
  if not v_second.created or v_second.review_task_id is not null then
    raise exception 'a second candidate for the same requisition opened another task';
  end if;

  select * into v_closed from public.record_posting_verification(
    v_row || jsonb_build_object('verification_key', repeat('d', 64), 'identity_key', 'jnj:www.careers.jnj.com:r-000001',
      'page_state', 'closed', 'outcome', 'closed', 'review_priority', 5));
  if not v_closed.created or v_closed.review_task_id is not null then
    raise exception 'a closed finding must be archived without a task';
  end if;

  select count(*) into v_tasks from public.review_tasks where entity_table = 'posting_verifications';
  if v_tasks <> 1 then raise exception 'expected exactly one verification task, found %', v_tasks; end if;

  begin
    perform public.record_posting_verification(v_row || jsonb_build_object(
      'verification_key', repeat('e', 64), 'content_sha256', null, 'snapshot_storage_path', null));
    raise exception 'apply_visible without a stored snapshot was accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.record_posting_verification(v_row || jsonb_build_object(
      'verification_key', repeat('f', 64), 'identity_key', null));
    raise exception 'review candidate without a requisition identity was accepted';
  exception when check_violation then null;
  end;

  begin
    perform public.record_posting_verification(v_row || jsonb_build_object(
      'verification_key', repeat('0', 64), 'governance_status', 'fetched', 'retrieved_at', null, 'page_state', 'blocked', 'outcome', 'unresolved_page'));
    raise exception 'a fetched row without retrieval time was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.posting_verifications set outcome = 'closed' where id = v_first.verification_id;
    raise exception 'verification evidence was mutable';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  begin
    delete from public.posting_verifications where id = v_first.verification_id;
    raise exception 'verification evidence was deletable';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
end $$;

-- Browser roles cannot write evidence or call the service RPC.
set local role anon;
do $$
begin
  begin
    perform public.record_posting_verification('{}'::jsonb);
    raise exception 'anon executed the service-only RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.posting_verifications;
    raise exception 'anon read private verification evidence';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    insert into public.posting_verifications (verification_key, run_id, observed_url, governance_status, ats_system, page_state, outcome)
    values (repeat('9', 64), 'x', 'https://example.com', 'not_required', 'unknown', 'not_fetched', 'rejected_not_requisition');
    raise exception 'authenticated inserted verification evidence';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.posting_verifications) then
    raise exception 'a non-officer session can read verification evidence';
  end if;
end $$;
reset role;

-- A verification-only source is governed for requisition checks but is never
-- list-fetched by the scheduler.
do $$
declare
  v_record uuid;
  v_source uuid;
  v_scheduled uuid[];
begin
  insert into public.source_records (name, source_type) values ('Verification-only test', 'website_page') returning id into v_record;
  insert into public.job_sources (
    source_record_id, source_name, source_kind, careers_url, enabled, terms_reviewed, terms_review_date, robots_reviewed, config_json
  ) values (
    v_record, 'Workday tenant', 'static_html', 'https://example.wd1.myworkdayjobs.com/site', true, true, current_date, true,
    '{"requisition_verification":{"enabled":true,"verification_only":true,"hosts":["example.wd1.myworkdayjobs.com"]}}'::jsonb
  ) returning id into v_source;
  select array_agg(id) into v_scheduled from public.schedule_due_source_fetch_runs(10) id;
  if exists (select 1 from public.source_fetch_runs where job_source_id = v_source) then
    raise exception 'verification-only source was scheduled for a list fetch';
  end if;
  update public.job_sources set config_json = '{}'::jsonb where id = v_source;
  perform public.schedule_due_source_fetch_runs(10);
  if not exists (select 1 from public.source_fetch_runs where job_source_id = v_source) then
    raise exception 'an ordinary governed source stopped being scheduled';
  end if;
end $$;

rollback;
