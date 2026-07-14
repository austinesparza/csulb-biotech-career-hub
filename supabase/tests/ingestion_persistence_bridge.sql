\set ON_ERROR_STOP on

-- Phase 2B local integration test: exercises transactional RPC and persistence invariants.
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
  v_sr uuid;
  v_js uuid;
  v_run uuid;
  v_run2 uuid;
  v_payload uuid;
  v_payload2 uuid;
  v_out record;
  v_posting uuid;
  v_opp uuid;
  v_updated integer;
begin
  insert into public.source_records (name, source_type)
  values ('_phase2b_int_sr', 'website_page')
  returning id into v_sr;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed
  )
  values (v_sr, 'phase2b-int-source', 'greenhouse', 'https://example.com/careers', true, true, current_date, true)
  returning id into v_js;

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, started_at)
  values (v_js, 'manual', 'running', now(), now())
  returning id into v_run;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, final_url, content_type,
    status_code, sha256, size_bytes, storage_path
  ) values (
    v_run, 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    'application/json', 200, lpad('a', 64, 'a'), 0,
    'source/test/a/a.txt'
  ) returning id into v_payload;

  perform _assert(
    'payload_metadata_inserted',
    exists(select 1 from public.source_payloads where id = v_payload and size_bytes = 0),
    'payload metadata row missing'
  );

  select * into v_out from public.upsert_source_posting_observation(
    v_run,
    v_js,
    'greenhouse:test:123',
    'https://example.com/jobs/123',
    '123',
    'Acme Biotech',
    'acme biotech',
    'Research Intern',
    'research intern',
    'Long Beach, CA',
    'long beach, ca',
    'hybrid',
    'internship',
    'internship',
    'Research',
    'biotech',
    date '2026-07-01',
    date '2026-08-01',
    'hard',
    'open',
    80,
    1::smallint,
    '{}'::jsonb,
    '{}'::text[],
    v_payload,
    lpad('b', 64, 'b'),
    '2026-07-13T00:00:00Z'::timestamptz
  );

  v_posting := v_out.posting_id;

  perform _assert('rpc_creates_posting', v_out.created and not v_out.stale_observation, 'posting not created by rpc');

  select * into v_out from public.upsert_source_posting_observation(
    v_run,
    v_js,
    'greenhouse:test:123',
    'https://example.com/jobs/123',
    '123',
    'Acme Biotech',
    'acme biotech',
    'Research Intern',
    'research intern',
    'Long Beach, CA',
    'long beach, ca',
    'hybrid',
    'internship',
    'internship',
    'Research',
    'biotech',
    date '2026-07-01',
    date '2026-08-01',
    'hard',
    'open',
    80,
    1::smallint,
    '{}'::jsonb,
    '{}'::text[],
    v_payload,
    lpad('b', 64, 'b'),
    '2026-07-13T00:00:00Z'::timestamptz
  );

  perform _assert('rpc_reports_unchanged_replay', not v_out.created and not v_out.material_changed and not v_out.stale_observation, 'unchanged replay not detected');

  select * into v_out from public.upsert_source_posting_observation(
    v_run,
    v_js,
    'greenhouse:test:123',
    'https://example.com/jobs/123',
    '123',
    'Acme Biotech',
    'acme biotech',
    'Research Intern II',
    'research intern ii',
    'Long Beach, CA',
    'long beach, ca',
    'hybrid',
    'internship',
    'internship',
    'Research',
    'biotech',
    date '2026-07-01',
    date '2026-08-01',
    'hard',
    'open',
    80,
    1::smallint,
    '{}'::jsonb,
    '{}'::text[],
    v_payload,
    lpad('c', 64, 'c'),
    '2026-07-14T00:00:00Z'::timestamptz
  );

  perform _assert('rpc_reports_material_change', v_out.material_changed and not v_out.stale_observation, 'material change not detected');

  select * into v_out from public.upsert_source_posting_observation(
    v_run,
    v_js,
    'greenhouse:test:123',
    'https://example.com/jobs/123',
    '123',
    'Acme Biotech',
    'acme biotech',
    'Old Replay',
    'old replay',
    'Long Beach, CA',
    'long beach, ca',
    'hybrid',
    'internship',
    'internship',
    'Research',
    'biotech',
    date '2026-07-01',
    date '2026-08-01',
    'hard',
    'open',
    80,
    1::smallint,
    '{}'::jsonb,
    '{}'::text[],
    v_payload,
    lpad('d', 64, 'd'),
    '2026-07-12T00:00:00Z'::timestamptz
  );

  perform _assert('rpc_rejects_stale_observation_regression', v_out.stale_observation and not v_out.material_changed, 'stale observation should be rejected');

  -- Verify version idempotency by source_fetch_run_id (not material_hash)
  -- Set up a second fetch run and payload for further version tests
  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, started_at)
  values (v_js, 'manual', 'running', now(), now())
  returning id into v_run2;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, final_url, content_type,
    status_code, sha256, size_bytes, storage_path
  ) values (
    v_run2, 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    'application/json', 200, lpad('e', 64, 'e'), 123,
    'source/test/e/e.txt'
  ) returning id into v_payload2;

  -- Insert first version for run2 (different hash = 'e')
  insert into public.source_posting_versions (
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash,
    normalized_json, score_breakdown_json, field_diff_json
  ) values (
    v_posting, v_run2, v_payload2,
    '1.0.0', false, lpad('e', 64, 'e'),
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
  );

  begin
    -- Same run, any hash: must conflict on (source_posting_id, source_fetch_run_id)
    insert into public.source_posting_versions (
      source_posting_id, source_fetch_run_id, source_payload_id,
      connector_version, is_material_change, material_hash,
      normalized_json, score_breakdown_json, field_diff_json
    ) values (
      v_posting, v_run2, v_payload2,
      '1.0.0', false, lpad('f', 64, 'f'), -- different material_hash, same run
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
    );
    perform _assert('version_unique_run_prevents_duplicate', false, 'duplicate run version insert accepted');
  exception when unique_violation then
    perform _assert('version_unique_run_prevents_duplicate', true);
  end;

  -- Different runs with the same material_hash must NOT conflict (A → B → A allowed)
  -- Re-use v_run2/v_payload2 for "run 3" (hash matching run 1's 'b' hash)
  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, started_at)
  values (v_js, 'manual', 'running', now(), now())
  returning id into v_run2;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, final_url, content_type,
    status_code, sha256, size_bytes, storage_path
  ) values (
    v_run2, 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
    'application/json', 200, lpad('g', 64, 'g'), 456,
    'source/test/g/g.txt'
  ) returning id into v_payload2;

  begin
    -- Same hash as first version (run 1 used 'b'), but different run — must succeed
    insert into public.source_posting_versions (
      source_posting_id, source_fetch_run_id, source_payload_id,
      connector_version, is_material_change, material_hash,
      normalized_json, score_breakdown_json, field_diff_json
    ) values (
      v_posting, v_run2, v_payload2,
      '1.0.0', true, lpad('b', 64, 'b'), -- same hash as first version in run 1
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb
    );
    perform _assert('aba_version_history_allowed', true, 'A->B->A history must be allowed across different runs');
  exception when unique_violation then
    perform _assert('aba_version_history_allowed', false, 'unique violation blocked A->B->A history — idempotency key is wrong');
  end;

  insert into public.opportunities (source_record_id, title, status, review_status, public_safe)
  values (v_sr, 'Pending bridge opportunity', 'needs_review', 'pending', false)
  returning id into v_opp;

  insert into public.review_tasks (task_type, entity_table, entity_id, status, notes)
  values ('source_changed', 'opportunities', v_opp, 'open', '[source_changed:hash1] changed');

  begin
    insert into public.review_tasks (task_type, entity_table, entity_id, status, notes)
    values ('source_changed', 'opportunities', v_opp, 'open', '[source_changed:hash1] changed');
    perform _assert('review_task_open_unique_blocks_duplicate', false, 'duplicate open task accepted');
  exception when unique_violation then
    perform _assert('review_task_open_unique_blocks_duplicate', true);
  end;

  update public.source_fetch_runs
     set status = 'cancelled',
         finished_at = now()
   where id = v_run2;

  update public.source_fetch_runs
     set status = 'completed',
         finished_at = now()
   where id = v_run2
     and status = 'running';

  get diagnostics v_updated = row_count;
  perform _assert('compare_and_set_prevents_cancelled_overwrite', v_updated = 0, 'cancelled run should not be overwritten');

  insert into public.opportunity_source_links (
    opportunity_id, source_posting_id, match_type, is_primary
  ) values (
    v_opp, v_posting, 'exact', true
  );

  begin
    insert into public.opportunity_source_links (
      opportunity_id, source_posting_id, match_type, is_primary
    ) values (
      v_opp, gen_random_uuid(), 'exact', true
    );
    perform _assert('one_primary_source_link_enforced', false, 'second primary link accepted');
  exception when unique_violation then
    perform _assert('one_primary_source_link_enforced', true);
  end;
end
$$;

select * from _results order by check_name;

rollback;
