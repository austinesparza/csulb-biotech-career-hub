\set ON_ERROR_STOP on

-- Phase 2B RPC integration test: exercises persist_posting_observation,
-- create_pending_opportunity, privilege restrictions, and A → B → A history.
begin;

create temp table _results (check_name text primary key, result text not null) on commit drop;

create or replace function _assert(p_name text, p_passed boolean, p_msg text default '')
returns void
language plpgsql as $$
begin
  if p_passed then
    insert into _results values (p_name, 'PASS');
  else
    insert into _results values (p_name, format('FAIL: %s', p_msg));
    raise exception 'Assertion failed: % (%)', p_name, p_msg;
  end if;
end;
$$;

do $$
declare
  v_sr      uuid;
  v_js      uuid;
  v_run1    uuid;
  v_run2    uuid;
  v_run3    uuid;
  v_payload uuid;
  v_out     record;
  v_posting uuid;
  v_ver1    uuid;
  v_ver2    uuid;
  v_ver3    uuid;
  v_opp     uuid;
begin
  -- ── Setup ────────────────────────────────────────────────────────────────

  insert into public.source_records (name, source_type)
  values ('_rpc_int_sr', 'website_page')
  returning id into v_sr;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed
  )
  values (v_sr, 'rpc-int-source', 'greenhouse', 'https://example.com/careers', true, true, current_date, true)
  returning id into v_js;

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, started_at)
  values (v_js, 'manual', 'running', now(), now())
  returning id into v_run1;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, final_url, content_type,
    status_code, sha256, size_bytes, storage_path
  ) values (
    v_run1,
    'https://boards-api.greenhouse.io/v1/boards/rpc-test/jobs?content=true',
    'https://boards-api.greenhouse.io/v1/boards/rpc-test/jobs?content=true',
    'application/json', 200, lpad('a', 64, 'a'), 512,
    'source/rpc-test/a/a.json'
  ) returning id into v_payload;

  -- ── 1. persist_posting_observation: first observation creates posting + version + task ────

  select * into v_out from public.persist_posting_observation(
    v_run1, v_js,
    'greenhouse:rpc-test:42',
    'https://example.com/jobs/42',
    '42',
    'Acme Corp', 'acme corp',
    'Lab Technician', 'lab technician',
    'Los Angeles, CA', 'los angeles, ca',
    'onsite', 'full_time', 'entry_level',
    'Research', 'biotech',
    date '2026-07-01', date '2026-09-30', 'hard',
    'open',
    75, 1::smallint,
    '{"score":75}'::jsonb, '{}'::text[],
    v_payload, lpad('b', 64, 'b'),
    '2026-07-13T00:00:00Z'::timestamptz,
    '1.0.0',
    '{"identityKey":"greenhouse:rpc-test:42","title":"Lab Technician"}'::jsonb,
    60
  );

  v_posting := v_out.posting_id;
  v_ver1    := v_out.version_id;

  perform _assert('rpc_creates_posting',       v_out.created          and not v_out.stale_observation, 'posting not created');
  perform _assert('rpc_version_inserted_new',  v_out.version_inserted,                                'first version not inserted');
  perform _assert('rpc_task_created_new',      v_out.review_task_type = 'source_new',                 'source_new task not created');
  perform _assert('rpc_version_id_non_null',   v_ver1 is not null,                                    'version_id is null');

  -- ── 2. Same-run replay is idempotent (no duplicate posting/version/task) ──

  select * into v_out from public.persist_posting_observation(
    v_run1, v_js,
    'greenhouse:rpc-test:42',
    'https://example.com/jobs/42',
    '42',
    'Acme Corp', 'acme corp',
    'Lab Technician', 'lab technician',
    'Los Angeles, CA', 'los angeles, ca',
    'onsite', 'full_time', 'entry_level',
    'Research', 'biotech',
    date '2026-07-01', date '2026-09-30', 'hard',
    'open',
    75, 1::smallint,
    '{"score":75}'::jsonb, '{}'::text[],
    v_payload, lpad('b', 64, 'b'),
    '2026-07-13T00:00:00Z'::timestamptz,
    '1.0.0',
    '{"identityKey":"greenhouse:rpc-test:42","title":"Lab Technician"}'::jsonb,
    60
  );

  perform _assert('replay_no_duplicate_posting', not v_out.created,          'replay incorrectly reported created=true');
  perform _assert('replay_no_duplicate_version', not v_out.version_inserted, 'replay inserted a second version for same run');
  perform _assert('replay_version_count', (
    select count(*) = 1 from public.source_posting_versions where source_posting_id = v_posting
  ), 'expected exactly 1 version after replay');
  perform _assert('replay_task_count', (
    select count(*) = 1 from public.review_tasks where entity_id = v_posting and status = 'open'
  ), 'expected exactly 1 open task after replay');

  -- ── 3. Run 2: material change (hash 'c') ─────────────────────────────────

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, started_at)
  values (v_js, 'manual', 'running', now(), now())
  returning id into v_run2;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, final_url, content_type,
    status_code, sha256, size_bytes, storage_path
  ) values (
    v_run2,
    'https://boards-api.greenhouse.io/v1/boards/rpc-test/jobs?content=true',
    'https://boards-api.greenhouse.io/v1/boards/rpc-test/jobs?content=true',
    'application/json', 200, lpad('c', 64, 'c'), 521,
    'source/rpc-test/c/c.json'
  ) returning id into v_payload;

  select * into v_out from public.persist_posting_observation(
    v_run2, v_js,
    'greenhouse:rpc-test:42',
    'https://example.com/jobs/42',
    '42',
    'Acme Corp', 'acme corp',
    'Lab Technician II', 'lab technician ii',  -- title changed
    'Los Angeles, CA', 'los angeles, ca',
    'onsite', 'full_time', 'entry_level',
    'Research', 'biotech',
    date '2026-07-01', date '2026-09-30', 'hard',
    'open',
    76, 1::smallint,
    '{"score":76}'::jsonb, '{}'::text[],
    v_payload, lpad('c', 64, 'c'),
    '2026-07-14T00:00:00Z'::timestamptz,
    '1.0.0',
    '{"identityKey":"greenhouse:rpc-test:42","title":"Lab Technician II"}'::jsonb,
    60
  );

  v_ver2 := v_out.version_id;

  perform _assert('run2_material_changed',      v_out.material_changed and not v_out.stale_observation, 'run2 material change not detected');
  perform _assert('run2_version_inserted',      v_out.version_inserted,                                 'run2 version not inserted');
  perform _assert('run2_version_different',     v_ver2 <> v_ver1,                                       'run2 version id same as run1');
  perform _assert('run2_version_count', (
    select count(*) = 2 from public.source_posting_versions where source_posting_id = v_posting
  ), 'expected 2 versions after run2');

  -- ── 4. Run 3: A → B → A — same hash as run 1 must produce a third version ─

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, started_at)
  values (v_js, 'manual', 'running', now(), now())
  returning id into v_run3;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, final_url, content_type,
    status_code, sha256, size_bytes, storage_path
  ) values (
    v_run3,
    'https://boards-api.greenhouse.io/v1/boards/rpc-test/jobs?content=true',
    'https://boards-api.greenhouse.io/v1/boards/rpc-test/jobs?content=true',
    'application/json', 200, lpad('d', 64, 'd'), 512,
    'source/rpc-test/d/d.json'
  ) returning id into v_payload;

  select * into v_out from public.persist_posting_observation(
    v_run3, v_js,
    'greenhouse:rpc-test:42',
    'https://example.com/jobs/42',
    '42',
    'Acme Corp', 'acme corp',
    'Lab Technician', 'lab technician',  -- title reverted to run1 value
    'Los Angeles, CA', 'los angeles, ca',
    'onsite', 'full_time', 'entry_level',
    'Research', 'biotech',
    date '2026-07-01', date '2026-09-30', 'hard',
    'open',
    75, 1::smallint,
    '{"score":75}'::jsonb, '{}'::text[],
    v_payload, lpad('b', 64, 'b'),  -- same hash as run 1 ('b')
    '2026-07-15T00:00:00Z'::timestamptz,
    '1.0.0',
    '{"identityKey":"greenhouse:rpc-test:42","title":"Lab Technician"}'::jsonb,
    60
  );

  v_ver3 := v_out.version_id;

  perform _assert('aba_material_changed',  v_out.material_changed and not v_out.stale_observation, 'A→B→A: run3 material change not detected');
  perform _assert('aba_version_inserted',  v_out.version_inserted,                                 'A→B→A: run3 version not inserted');
  perform _assert('aba_version_unique',    v_ver3 <> v_ver1 and v_ver3 <> v_ver2,                  'A→B→A: run3 version id duplicates earlier run');
  perform _assert('aba_version_count', (
    select count(*) = 3 from public.source_posting_versions where source_posting_id = v_posting
  ), 'A→B→A: expected exactly 3 versions');
  -- All three versions are immutable — none were updated
  perform _assert('aba_versions_immutable', (
    select count(*) = 3
    from public.source_posting_versions
    where source_posting_id = v_posting
      and material_hash in (lpad('b',64,'b'), lpad('c',64,'c'))
  ), 'A→B→A: version hashes are wrong');

  -- ── 5. Stale observation is rejected ─────────────────────────────────────

  select * into v_out from public.persist_posting_observation(
    v_run3, v_js,
    'greenhouse:rpc-test:42',
    'https://example.com/jobs/42',
    '42',
    'Acme Corp', 'acme corp',
    'Old Title', 'old title',
    'Los Angeles, CA', 'los angeles, ca',
    'onsite', 'full_time', 'entry_level',
    'Research', 'biotech',
    date '2026-07-01', date '2026-09-30', 'hard',
    'open',
    75, 1::smallint,
    '{}'::jsonb, '{}'::text[],
    v_payload, lpad('z', 64, 'z'),
    '2026-07-10T00:00:00Z'::timestamptz,  -- earlier than last_seen_at
    '1.0.0', '{}'::jsonb, 60
  );

  perform _assert('stale_observation_rejected', v_out.stale_observation and not v_out.material_changed, 'stale observation not rejected');

  -- ── 6. Privilege verification ─────────────────────────────────────────────

  -- persist_posting_observation must be granted only to service_role
  perform _assert('persist_rpc_not_public', not exists (
    select 1 from information_schema.role_routine_grants
    where routine_name = 'persist_posting_observation'
      and grantee in ('public', 'anon', 'authenticated')
  ), 'persist_posting_observation is executable by public/anon/authenticated');

  -- create_pending_opportunity must be granted only to service_role
  perform _assert('create_opp_rpc_not_public', not exists (
    select 1 from information_schema.role_routine_grants
    where routine_name = 'create_pending_opportunity'
      and grantee in ('public', 'anon', 'authenticated')
  ), 'create_pending_opportunity is executable by public/anon/authenticated');

  -- upsert_source_posting_observation must NOT be callable by public/anon/authenticated
  perform _assert('old_rpc_not_public', not exists (
    select 1 from information_schema.role_routine_grants
    where routine_name = 'upsert_source_posting_observation'
      and grantee in ('public', 'anon', 'authenticated')
  ), 'upsert_source_posting_observation is still executable by public/anon/authenticated');

  -- ── 7. Idempotency-key index exists with correct definition ───────────────

  perform _assert('idx_posting_run_exists', exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'source_posting_versions'
      and indexname  = 'idx_source_posting_versions_posting_run'
  ), 'idx_source_posting_versions_posting_run index missing');

  perform _assert('idx_posting_material_dropped', not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename  = 'source_posting_versions'
      and indexname  = 'idx_source_posting_versions_posting_material'
  ), 'old material_hash unique index still present');

end
$$;

select * from _results order by check_name;

rollback;
