\set ON_ERROR_STOP on

-- automated_ingestion_schema.sql
-- Verification script for Phase 1 automated ingestion schema.
-- All checks run inside a single transaction that is rolled back at the end,
-- so this script is safe to run against any disposable test database after
-- applying 0001_init.sql, 0002_ingestion_task_types.sql, 0003_automated_ingestion_schema.sql,
-- and 0004_source_payload_bucket.sql.
--
-- WARNING: do NOT run supabase db push against a linked remote project for local
-- verification.  Use the local stack only:
--
--   npx supabase start
--   npx supabase db reset --local
--   npx supabase db lint --local
--   npx supabase status
--   export LOCAL_DATABASE_URL='<DB URL from npx supabase status output>'
--   psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/automated_ingestion_schema.sql
--
-- Exit codes: the script raises an exception on the first failed assertion and
-- prints a PASS/FAIL summary for each check attempted before the failure.

begin;

-- ============================================================
-- Helper
-- ============================================================

do $$
begin
  raise notice '=== Phase 1 automated ingestion schema verification ===';
end
$$;

create temp table _results (
  check_name text primary key,
  result     text not null  -- 'PASS' | 'FAIL: <reason>'
) on commit drop;

create or replace function _assert(p_name text, p_passed boolean, p_msg text default '')
returns void
language plpgsql as $$
begin
  if p_passed then
    insert into _results values (p_name, 'PASS');
    raise notice 'PASS  %', p_name;
  else
    insert into _results values (p_name, format('FAIL: %s', p_msg));
    raise notice 'FAIL  %  — %', p_name, p_msg;
    raise exception 'Assertion failed: %  (%)', p_name, p_msg;
  end if;
end;
$$;

-- ============================================================
-- 1. All six tables exist
-- ============================================================

do $$
declare
  t text;
  exists_flag boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) into exists_flag;
    perform _assert(format('table_exists_%s', t), exists_flag,
                    format('table public.%s not found', t));
  end loop;
end
$$;

-- ============================================================
-- 2. All four new task_type enum values exist
-- ============================================================

do $$
declare
  v text;
  exists_flag boolean;
begin
  foreach v in array array['source_new','source_changed','source_reopened','source_health'] loop
    select exists (
      select 1 from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'task_type' and e.enumlabel = v
    ) into exists_flag;
    perform _assert(format('task_type_enum_%s', v), exists_flag,
                    format('enum value %s not found in task_type', v));
  end loop;
end
$$;

-- ============================================================
-- Shared fixture for constraint tests (sections 3–4)
-- ============================================================
-- These rows are inserted once and reused by all inner test blocks.
-- The outer BEGIN/ROLLBACK ensures nothing persists.

do $$
declare
  v_sr_id uuid;
  v_js_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('_fixture_sr_constraints', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'fixture-source', 'rss', 'https://example.com/feed')
  returning id into v_js_id;

  -- Store IDs in GUC for access from subsequent DO blocks in this transaction.
  perform set_config('test.fixture_js_id', v_js_id::text, true);
  perform set_config('test.fixture_sr_id', v_sr_id::text, true);
end
$$;

-- ============================================================
-- 3. Invalid statuses are rejected
-- ============================================================

-- source_fetch_runs.status
do $$
declare v_js_id uuid := current_setting('test.fixture_js_id')::uuid;
begin
  begin
    insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
    values (v_js_id, 'scheduled', 'bogus_status', now());
    perform _assert('reject_invalid_fetch_run_status', false, 'invalid status was accepted');
  exception when check_violation then
    perform _assert('reject_invalid_fetch_run_status', true);
  end;
end
$$;

-- source_postings.current_status
do $$
declare v_js_id uuid := current_setting('test.fixture_js_id')::uuid;
begin
  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key,
      last_material_hash, current_status
    ) values (
      v_js_id, 'https://example.com/job/bad-status', 'key-bad-status',
      lpad('a', 64, 'a'), 'not_a_status'
    );
    perform _assert('reject_invalid_posting_status', false, 'invalid status was accepted');
  exception when check_violation then
    perform _assert('reject_invalid_posting_status', true);
  end;
end
$$;

-- source_fetch_runs.error_class
do $$
declare v_js_id uuid := current_setting('test.fixture_js_id')::uuid;
begin
  begin
    insert into public.source_fetch_runs (
      job_source_id, trigger_kind, status, scheduled_for, error_class
    ) values (v_js_id, 'manual', 'completed', now(), 'mystery_error');
    perform _assert('reject_invalid_error_class', false, 'invalid error_class was accepted');
  exception when check_violation then
    perform _assert('reject_invalid_error_class', true);
  end;
end
$$;

-- ============================================================
-- 4. Negative counters are rejected
-- ============================================================

do $$
declare v_js_id uuid := current_setting('test.fixture_js_id')::uuid;
begin
  begin
    insert into public.source_fetch_runs (
      job_source_id, trigger_kind, status, scheduled_for, records_seen
    ) values (v_js_id, 'scheduled', 'pending', now(), -1);
    perform _assert('reject_negative_records_seen', false, 'negative counter was accepted');
  exception when check_violation then
    perform _assert('reject_negative_records_seen', true);
  end;
end
$$;

do $$
declare v_js_id uuid := current_setting('test.fixture_js_id')::uuid;
begin
  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key,
      last_material_hash, consecutive_misses
    ) values (v_js_id, 'https://example.com/job/neg-miss', 'key-neg-miss',
              lpad('b', 64, 'b'), -5);
    perform _assert('reject_negative_consecutive_misses', false, 'negative counter was accepted');
  exception when check_violation then
    perform _assert('reject_negative_consecutive_misses', true);
  end;
end
$$;

do $$
declare
  v_sr2 uuid;
begin
  -- source_record_id must be unique; use a fresh one to avoid duplicate-key error
  insert into public.source_records (name, source_type)
  values ('_fixture_sr_neg_fail', 'website_page') returning id into v_sr2;

  begin
    insert into public.job_sources (
      source_record_id, source_name, source_kind, careers_url, consecutive_failures
    ) values (v_sr2, 'neg-fail', 'rss', 'https://example.com/neg', -1);
    perform _assert('reject_negative_consecutive_failures', false, 'negative counter was accepted');
  exception when check_violation then
    perform _assert('reject_negative_consecutive_failures', true);
  end;
end
$$;

-- ============================================================
-- 5. Score and source-health constraints
-- ============================================================

do $$
declare v_js_id uuid := current_setting('test.fixture_js_id')::uuid;
begin
  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash, relevance_score
    ) values (
      v_js_id, 'https://example.com/job/score-low', 'score-low',
      lpad('1', 64, '1'), -1
    );
    perform _assert('reject_relevance_score_below_range', false, 'relevance_score -1 was accepted');
  exception when check_violation then
    perform _assert('reject_relevance_score_below_range', true);
  end;

  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash, relevance_score
    ) values (
      v_js_id, 'https://example.com/job/score-high', 'score-high',
      lpad('2', 64, '2'), 101
    );
    perform _assert('reject_relevance_score_above_range', false, 'relevance_score 101 was accepted');
  exception when check_violation then
    perform _assert('reject_relevance_score_above_range', true);
  end;

  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash, relevance_score
    ) values (
      v_js_id, 'https://example.com/job/score-no-version', 'score-no-version',
      lpad('3', 64, '3'), 50
    );
    perform _assert('reject_relevance_score_without_version', false, 'score without version was accepted');
  exception when check_violation then
    perform _assert('reject_relevance_score_without_version', true);
  end;

  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash, relevance_score_version
    ) values (
      v_js_id, 'https://example.com/job/version-no-score', 'version-no-score',
      lpad('4', 64, '4'), 1
    );
    perform _assert('reject_relevance_score_version_without_score', false, 'version without score was accepted');
  exception when check_violation then
    perform _assert('reject_relevance_score_version_without_score', true);
  end;

  insert into public.source_postings (
    job_source_id, canonical_url, identity_key, last_material_hash, relevance_score, relevance_score_version
  ) values (
    v_js_id, 'https://example.com/job/score-valid', 'score-valid',
    lpad('5', 64, '5'), 100, 1
  );
  perform _assert('accept_relevance_score_with_version', true);
end
$$;

do $$
declare
  v_sr_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-http-status-low', 'website_page')
  returning id into v_sr_id;

  begin
    insert into public.job_sources (
      source_record_id, source_name, source_kind, careers_url, last_http_status
    ) values (v_sr_id, 'http-low', 'rss', 'https://example.com/http-low', 99);
    perform _assert('reject_last_http_status_below_range', false, 'last_http_status 99 was accepted');
  exception when check_violation then
    perform _assert('reject_last_http_status_below_range', true);
  end;
end
$$;

do $$
declare
  v_sr_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-http-status-high', 'website_page')
  returning id into v_sr_id;

  begin
    insert into public.job_sources (
      source_record_id, source_name, source_kind, careers_url, last_http_status
    ) values (v_sr_id, 'http-high', 'rss', 'https://example.com/http-high', 600);
    perform _assert('reject_last_http_status_above_range', false, 'last_http_status 600 was accepted');
  exception when check_violation then
    perform _assert('reject_last_http_status_above_range', true);
  end;
end
$$;

do $$
declare
  v_sr_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-hash-upper', 'website_page')
  returning id into v_sr_id;

  begin
    insert into public.job_sources (
      source_record_id, source_name, source_kind, careers_url, last_payload_hash
    ) values (v_sr_id, 'hash-upper', 'rss', 'https://example.com/hash-upper', lpad('A', 64, 'A'));
    perform _assert('reject_last_payload_hash_uppercase', false, 'uppercase hash was accepted');
  exception when check_violation then
    perform _assert('reject_last_payload_hash_uppercase', true);
  end;
end
$$;

do $$
declare
  v_sr_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-hash-short', 'website_page')
  returning id into v_sr_id;

  begin
    insert into public.job_sources (
      source_record_id, source_name, source_kind, careers_url, last_payload_hash
    ) values (v_sr_id, 'hash-short', 'rss', 'https://example.com/hash-short', 'abc123');
    perform _assert('reject_last_payload_hash_invalid_length', false, 'short hash was accepted');
  exception when check_violation then
    perform _assert('reject_last_payload_hash_invalid_length', true);
  end;
end
$$;

do $$
declare
  v_sr_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-hash-valid', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, careers_url, last_http_status, last_payload_hash
  ) values (
    v_sr_id, 'hash-valid', 'rss', 'https://example.com/hash-valid', 200, lpad('a', 64, 'a')
  );
  perform _assert('accept_source_health_fields_valid', true);
end
$$;

-- ============================================================
-- 6. Duplicate source_record_id is rejected in job_sources
-- ============================================================

do $$
declare
  v_sr_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-dup', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'first', 'rss', 'https://example.com');

  begin
    insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
    values (v_sr_id, 'second', 'rss', 'https://example.com/2');
    perform _assert('reject_duplicate_source_record_id', false, 'duplicate source_record_id was accepted');
  exception when unique_violation then
    perform _assert('reject_duplicate_source_record_id', true);
  end;
end
$$;

-- ============================================================
-- 6. Duplicate (job_source_id, identity_key) is rejected in source_postings
-- ============================================================

do $$
declare
  v_sr_id uuid;
  v_js_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-identity', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'test-js-identity', 'greenhouse', 'https://boards.greenhouse.io/test')
  returning id into v_js_id;

  insert into public.source_postings (
    job_source_id, canonical_url, identity_key, last_material_hash
  ) values (v_js_id, 'https://boards.greenhouse.io/test/1', 'job-1', lpad('c', 64, 'c'));

  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash
    ) values (v_js_id, 'https://boards.greenhouse.io/test/1-dup', 'job-1', lpad('d', 64, 'd'));
    perform _assert('reject_duplicate_identity_key', false, 'duplicate identity_key was accepted');
  exception when unique_violation then
    perform _assert('reject_duplicate_identity_key', true);
  end;
end
$$;

-- ============================================================
-- 7. More than one primary link per opportunity is rejected
-- ============================================================

do $$
declare
  v_opp_id uuid;
  v_sr_id  uuid;
  v_js_id  uuid;
  v_sp1_id uuid;
  v_sp2_id uuid;
begin
  insert into public.companies (name, name_normalized)
  values ('Test Co Links', 'test co links')
  returning id into v_opp_id;

  insert into public.opportunities (company_id, title, source_record_id)
  select v_opp_id, 'Test Opp', null
  returning id into v_opp_id;

  insert into public.source_records (name, source_type)
  values ('test-sr-links', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'test-js-links', 'lever', 'https://jobs.lever.co/test')
  returning id into v_js_id;

  insert into public.source_postings (
    job_source_id, canonical_url, identity_key, last_material_hash
  ) values (v_js_id, 'https://jobs.lever.co/test/1', 'posting-1', lpad('e', 64, 'e'))
  returning id into v_sp1_id;

  insert into public.source_postings (
    job_source_id, canonical_url, identity_key, last_material_hash
  ) values (v_js_id, 'https://jobs.lever.co/test/2', 'posting-2', lpad('f', 64, 'f'))
  returning id into v_sp2_id;

  insert into public.opportunity_source_links (
    opportunity_id, source_posting_id, match_type, is_primary
  ) values (v_opp_id, v_sp1_id, 'exact', true);

  begin
    insert into public.opportunity_source_links (
      opportunity_id, source_posting_id, match_type, is_primary
    ) values (v_opp_id, v_sp2_id, 'exact', true);
    perform _assert('reject_second_primary_link', false, 'second is_primary link was accepted');
  exception when unique_violation then
    perform _assert('reject_second_primary_link', true);
  end;
end
$$;

-- ============================================================
-- 8. source_posting_versions cannot be updated
-- ============================================================

do $$
declare
  v_sr_id   uuid;
  v_js_id   uuid;
  v_sp_id   uuid;
  v_sfr_id  uuid;
  v_pay_id  uuid;
  v_spv_id  uuid;
  v_msg     text;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-immutable', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'test-js-immutable', 'rss', 'https://example.com/feed')
  returning id into v_js_id;

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
  values (v_js_id, 'manual', 'completed', now())
  returning id into v_sfr_id;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, sha256, size_bytes, storage_path
  ) values (
    v_sfr_id, 'https://example.com/feed',
    lpad('a', 64, 'a'), 1024, 'source-payloads/test.json'
  ) returning id into v_pay_id;

  insert into public.source_postings (
    job_source_id, canonical_url, identity_key, last_material_hash
  ) values (v_js_id, 'https://example.com/job/1', 'immut-key', lpad('b', 64, 'b'))
  returning id into v_sp_id;

  insert into public.source_posting_versions (
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash, normalized_json
  ) values (v_sp_id, v_sfr_id, v_pay_id, '1.0.0', true, lpad('c', 64, 'c'), '{}')
  returning id into v_spv_id;

  begin
    update public.source_posting_versions
       set connector_version = '1.0.1'
     where id = v_spv_id;
    perform _assert('reject_update_source_posting_versions', false, 'UPDATE was accepted');
  exception when sqlstate 'P0001' then
    -- Verify the trigger's specific message to confirm the right guard fired.
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'reject_update_source_posting_versions',
      position('append-only' in v_msg) > 0,
      format('exception raised but wrong message: %s', v_msg)
    );
  end;
end
$$;

-- ============================================================
-- 9. source_posting_versions cannot be deleted
-- ============================================================

do $$
declare
  v_sr_id   uuid;
  v_js_id   uuid;
  v_sp_id   uuid;
  v_sfr_id  uuid;
  v_pay_id  uuid;
  v_spv_id  uuid;
  v_msg     text;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-no-del', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'test-js-no-del', 'rss', 'https://example.com/feed2')
  returning id into v_js_id;

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
  values (v_js_id, 'manual', 'completed', now())
  returning id into v_sfr_id;

  insert into public.source_payloads (
    source_fetch_run_id, request_url, sha256, size_bytes, storage_path
  ) values (
    v_sfr_id, 'https://example.com/feed2',
    lpad('d', 64, 'd'), 512, 'source-payloads/test2.json'
  ) returning id into v_pay_id;

  insert into public.source_postings (
    job_source_id, canonical_url, identity_key, last_material_hash
  ) values (v_js_id, 'https://example.com/job/2', 'nodeltkey', lpad('e', 64, 'e'))
  returning id into v_sp_id;

  insert into public.source_posting_versions (
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash, normalized_json
  ) values (v_sp_id, v_sfr_id, v_pay_id, '1.0.0', true, lpad('f', 64, 'f'), '{}')
  returning id into v_spv_id;

  begin
    delete from public.source_posting_versions where id = v_spv_id;
    perform _assert('reject_delete_source_posting_versions', false, 'DELETE was accepted');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'reject_delete_source_posting_versions',
      position('append-only' in v_msg) > 0,
      format('exception raised but wrong message: %s', v_msg)
    );
  end;
end
$$;

-- ============================================================
-- 10. Queue claims do not return the same run twice (concurrent-worker simulation)
-- ============================================================
-- Two consecutive claims from different "workers" in the same session (serial,
-- not truly concurrent) verify that a claimed run is not re-claimable.
-- True concurrent-worker isolation requires separate sessions; that test is
-- documented in the UNTESTED section below.

do $$
declare
  v_sr_id  uuid;
  v_js_id  uuid;
  v_run_id uuid;
  v_a_id   uuid;
  v_b_id   uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-claim', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed
  ) values (
    v_sr_id, 'test-js-claim', 'greenhouse', 'https://boards.greenhouse.io/claim',
    true, true, current_date, true
  ) returning id into v_js_id;

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
  values (v_js_id, 'scheduled', 'pending', now() - interval '1 minute')
  returning id into v_run_id;

  select id into v_a_id from public.claim_source_fetch_runs('worker-A', 1);
  perform _assert('claim_returns_pending_run', v_a_id is not null,
                  'first claim returned no rows');
  perform _assert('claim_returns_correct_run', v_a_id = v_run_id,
                  format('expected %s, got %s', v_run_id, v_a_id));

  select id into v_b_id from public.claim_source_fetch_runs('worker-B', 1);
  perform _assert('second_claim_returns_nothing', v_b_id is null,
                  'second claim returned a row that should already be claimed');
end
$$;

-- ============================================================
-- 11. Enabled + policy-reviewed sources may be paused and are skipped by claim
-- ============================================================

do $$
declare
  v_sr_id     uuid;
  v_js_id     uuid;
  v_run_id    uuid;
  v_claimed_id uuid;
begin
  insert into public.source_records (name, source_type)
  values ('test-sr-paused-enabled', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (
    source_record_id, source_name, source_kind, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed,
    automatic_scheduling_paused_at
  ) values (
    v_sr_id, 'test-js-paused-enabled', 'rss', 'https://example.com/paused',
    true, true, current_date, true,
    now()
  ) returning id into v_js_id;

  perform _assert(
    'enabled_source_can_be_paused',
    exists (
      select 1
      from public.job_sources
      where id = v_js_id
        and enabled
        and automatic_scheduling_paused_at is not null
    ),
    'enabled+paused source insert failed'
  );

  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
  values (v_js_id, 'scheduled', 'pending', now() - interval '1 minute')
  returning id into v_run_id;

  select id into v_claimed_id from public.claim_source_fetch_runs('worker-paused-check', 1);
  perform _assert(
    'claim_skips_paused_enabled_source',
    v_claimed_id is null,
    format('expected no claim for paused source run %s, got %s', v_run_id, v_claimed_id)
  );
end
$$;

-- ============================================================
-- 12. Validate claim_source_fetch_runs input guardrails
-- ============================================================

do $$
declare v_msg text;
begin
  begin
    perform public.claim_source_fetch_runs('', 1);
    perform _assert('claim_rejects_empty_worker_id', false, 'empty worker_id was accepted');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'claim_rejects_empty_worker_id',
      position('p_worker_id must be a nonempty string' in v_msg) > 0,
      format('wrong message: %s', v_msg)
    );
  end;
end
$$;

do $$
declare v_msg text;
begin
  begin
    perform public.claim_source_fetch_runs(null, 1);
    perform _assert('claim_rejects_null_worker_id', false, 'null worker_id was accepted');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'claim_rejects_null_worker_id',
      position('p_worker_id must be a nonempty string' in v_msg) > 0,
      format('wrong message: %s', v_msg)
    );
  end;
end
$$;

do $$
declare v_msg text;
begin
  begin
    perform public.claim_source_fetch_runs('worker-test', 0);
    perform _assert('claim_rejects_batch_size_zero', false, 'batch size 0 was accepted');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'claim_rejects_batch_size_zero',
      position('p_limit must be between 1 and 50' in v_msg) > 0,
      format('wrong message: %s', v_msg)
    );
  end;
end
$$;

do $$
declare v_msg text;
begin
  begin
    perform public.claim_source_fetch_runs('worker-test', 51);
    perform _assert('claim_rejects_batch_size_51', false, 'batch size 51 was accepted');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'claim_rejects_batch_size_51',
      position('p_limit must be between 1 and 50' in v_msg) > 0,
      format('wrong message: %s', v_msg)
    );
  end;
end
$$;

do $$
declare v_msg text;
begin
  begin
    perform public.claim_source_fetch_runs('worker-test', null);
    perform _assert('claim_rejects_null_batch_size', false, 'null batch size was accepted');
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    perform _assert(
      'claim_rejects_null_batch_size',
      position('p_limit must not be null' in v_msg) > 0,
      format('wrong message: %s', v_msg)
    );
  end;
end
$$;

-- ============================================================
-- 12. RLS is enabled on all six tables
-- ============================================================

do $$
declare
  t text;
  rls_on boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select relrowsecurity into rls_on
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t;
    perform _assert(format('rls_enabled_%s', t), coalesce(rls_on, false),
                    format('RLS not enabled on %s', t));
  end loop;
end
$$;

-- ============================================================
-- 13. Officer SELECT policies exist for all six tables
-- ============================================================

do $$
declare
  t text;
  pol_exists boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and policyname = format('officer_select_%s', t)
        and cmd = 'SELECT'
        and roles @> array['authenticated']::name[]
    ) into pol_exists;
    perform _assert(format('officer_select_policy_exists_%s', t), pol_exists,
                    format('officer_select_%s policy missing or misconfigured', t));
  end loop;
end
$$;

-- ============================================================
-- 14. No INSERT or UPDATE policies exist for authenticated on any table
-- ============================================================

do $$
declare
  t text;
  pol_exists boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('INSERT','UPDATE')
        and roles @> array['authenticated']::name[]
    ) into pol_exists;
    perform _assert(format('no_authenticated_mutate_policy_%s', t), not pol_exists,
                    format('unexpected INSERT or UPDATE policy for authenticated on %s', t));
  end loop;
end
$$;

-- ============================================================
-- 15. No DELETE policy for authenticated on any table
-- ============================================================

do $$
declare
  t text;
  pol_exists boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd = 'DELETE'
        and roles @> array['authenticated']::name[]
    ) into pol_exists;
    perform _assert(format('no_officer_delete_policy_%s', t), not pol_exists,
                    format('unexpected DELETE policy for authenticated on %s', t));
  end loop;
end
$$;

-- ============================================================
-- 16. Table-level ACL checks (has_table_privilege)
-- ============================================================

do $$
declare
  t text;
  priv text;
  has_it boolean;
begin
  -- anon must have NO privileges on any of the six ingestion tables.
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    foreach priv in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      select has_table_privilege('anon', format('public.%s', t), priv)
      into has_it;
      perform _assert(
        format('anon_no_%s_%s', lower(priv), t),
        not coalesce(has_it, false),
        format('anon has %s on public.%s', priv, t)
      );
    end loop;
  end loop;
end
$$;

do $$
declare
  t text;
  has_it boolean;
begin
  -- authenticated must have SELECT only; no INSERT, UPDATE, or DELETE.
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select has_table_privilege('authenticated', format('public.%s', t), 'SELECT') into has_it;
    perform _assert(format('authenticated_has_select_%s', t), coalesce(has_it, false),
                    format('authenticated missing SELECT on public.%s', t));

    select has_table_privilege('authenticated', format('public.%s', t), 'INSERT') into has_it;
    perform _assert(format('authenticated_no_insert_%s', t), not coalesce(has_it, false),
                    format('authenticated has INSERT on public.%s', t));

    select has_table_privilege('authenticated', format('public.%s', t), 'UPDATE') into has_it;
    perform _assert(format('authenticated_no_update_%s', t), not coalesce(has_it, false),
                    format('authenticated has UPDATE on public.%s', t));

    select has_table_privilege('authenticated', format('public.%s', t), 'DELETE') into has_it;
    perform _assert(format('authenticated_no_delete_%s', t), not coalesce(has_it, false),
                    format('authenticated has DELETE on public.%s', t));
  end loop;
end
$$;

do $$
declare
  t text;
  expect_select boolean;
  expect_insert boolean;
  expect_update boolean;
  expect_delete boolean;
  has_it boolean;
begin
  -- service_role must have explicit least-privilege grants.
  foreach t, expect_select, expect_insert, expect_update, expect_delete in
    select *
    from (values
      ('job_sources', true, true, true, false),
      ('source_fetch_runs', true, true, true, false),
      ('source_payloads', true, true, false, false),
      ('source_postings', true, true, true, false),
      ('source_posting_versions', true, true, false, false),
      ('opportunity_source_links', true, true, true, true)
    ) as expected(table_name, can_select, can_insert, can_update, can_delete)
  loop
    select has_table_privilege('service_role', format('public.%s', t), 'SELECT') into has_it;
    perform _assert(format('service_role_select_%s', t), coalesce(has_it, false) = expect_select,
                    format('service_role SELECT mismatch on public.%s', t));

    select has_table_privilege('service_role', format('public.%s', t), 'INSERT') into has_it;
    perform _assert(format('service_role_insert_%s', t), coalesce(has_it, false) = expect_insert,
                    format('service_role INSERT mismatch on public.%s', t));

    select has_table_privilege('service_role', format('public.%s', t), 'UPDATE') into has_it;
    perform _assert(format('service_role_update_%s', t), coalesce(has_it, false) = expect_update,
                    format('service_role UPDATE mismatch on public.%s', t));

    select has_table_privilege('service_role', format('public.%s', t), 'DELETE') into has_it;
    perform _assert(format('service_role_delete_%s', t), coalesce(has_it, false) = expect_delete,
                    format('service_role DELETE mismatch on public.%s', t));
  end loop;

  -- service_role must not have TRUNCATE on any ingestion table.
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select has_table_privilege('service_role', format('public.%s', t), 'TRUNCATE') into has_it;
    perform _assert(format('service_role_no_truncate_%s', t), not coalesce(has_it, false),
                    format('service_role has TRUNCATE on public.%s', t));
  end loop;
end
$$;

-- ============================================================
-- 17. Public view column arrays (exact, ordered)
-- ============================================================

do $$
declare
  expected_cols text[] := array[
    'id','company_name','title','posting_url','location','eligibility','focus_area',
    'deadline','deadline_text','start_date_text','paid_status','application_type',
    'status','public_notes','relevance_score','last_checked_at','first_seen_at','source_name'
  ];
  actual_cols text[];
begin
  select array_agg(column_name::text order by ordinal_position)
  into actual_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_opportunities';

  perform _assert(
    'public_opportunities_exact_columns',
    actual_cols = expected_cols,
    format('expected %s, got %s', expected_cols, actual_cols)
  );
end
$$;

do $$
declare
  expected_cols text[] := array[
    'id','name','website','location','industry_tags','description','open_count'
  ];
  actual_cols text[];
begin
  select array_agg(column_name::text order by ordinal_position)
  into actual_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_companies';

  perform _assert(
    'public_companies_exact_columns',
    actual_cols = expected_cols,
    format('expected %s, got %s', expected_cols, actual_cols)
  );
end
$$;

-- ============================================================
-- 18. No ingestion table exposed through a public_* view
-- ============================================================

do $$
declare
  t           text;
  view_name   text;
  view_refs   boolean;
begin
  -- Verify no public_* view references any of the six ingestion tables
  -- (belt-and-suspenders: confirmed by schema inspection of view definitions).
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from information_schema.view_column_usage
      where view_schema = 'public'
        and view_name like 'public\_%'
        and table_name = t
    ) into view_refs;
    perform _assert(
      format('ingestion_table_not_in_public_view_%s', t),
      not coalesce(view_refs, false),
      format('public_* view references ingestion table %s', t)
    );
  end loop;
end
$$;

-- ============================================================
-- 19. claim_source_fetch_runs EXECUTE is restricted to service_role
-- ============================================================

do $$
declare
  can_anon   boolean;
  can_authed boolean;
  can_svc    boolean;
begin
  select has_function_privilege('anon', 'public.claim_source_fetch_runs(text, integer)', 'EXECUTE')
  into can_anon;
  perform _assert('claim_fn_not_executable_by_anon', not coalesce(can_anon, false),
                  'anon role has EXECUTE on claim_source_fetch_runs');

  select has_function_privilege('authenticated', 'public.claim_source_fetch_runs(text, integer)', 'EXECUTE')
  into can_authed;
  perform _assert('claim_fn_not_executable_by_authenticated', not coalesce(can_authed, false),
                  'authenticated role has EXECUTE on claim_source_fetch_runs');

  select has_function_privilege('service_role', 'public.claim_source_fetch_runs(text, integer)', 'EXECUTE')
  into can_svc;
  perform _assert('claim_fn_executable_by_service_role', coalesce(can_svc, false),
                  'service_role does not have EXECUTE on claim_source_fetch_runs');
end
$$;

-- ============================================================
-- 20. Append-only trigger exists and is active
-- ============================================================

do $$
declare
  trig_exists boolean;
begin
  select exists (
    select 1 from pg_trigger
    where tgrelid = 'public.source_posting_versions'::regclass
      and tgname = 'trg_source_posting_versions_append_only'
      -- tgenabled values: 'O' = enabled for origin/local (default), 'A' = always,
      --                   'R' = replica, 'D' = disabled.
      -- 'O' is the standard enabled state; 'A' would also be acceptable.
      and tgenabled in ('O', 'A')
  ) into trig_exists;
  perform _assert('append_only_trigger_exists', trig_exists,
                  'trg_source_posting_versions_append_only not found or disabled');
end
$$;

-- ============================================================
-- 21. FORCE ROW SECURITY is NOT set
-- ============================================================

do $$
declare
  t text;
  force_rls boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select relforcerowsecurity into force_rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t;
    perform _assert(format('rls_not_forced_%s', t), not coalesce(force_rls, false),
                    format('FORCE ROW SECURITY is set on %s (unexpected for current schema design)', t));
  end loop;
end
$$;

-- ============================================================
-- 22. source-payloads storage bucket (conditional on storage schema)
-- ============================================================

do $$
declare
  schema_exists boolean;
  bucket_public boolean;
  bucket_file_size_limit bigint;
begin
  select exists (
    select 1 from information_schema.schemata where schema_name = 'storage'
  ) into schema_exists;

  if schema_exists then
    execute $q$
      select "public", file_size_limit
      from storage.buckets
      where id = 'source-payloads'
    $q$ into bucket_public, bucket_file_size_limit;

    perform _assert(
      'source_payloads_bucket_is_private',
      bucket_public is not distinct from false,
      format('bucket public flag: %s (expected false)', bucket_public)
    );

    perform _assert(
      'source_payloads_bucket_file_size_limit',
      bucket_file_size_limit = 52428800,
      format('bucket file_size_limit: %s (expected 52428800)', bucket_file_size_limit)
    );
  else
    raise notice 'SKIP  source_payloads_bucket_is_private — storage schema not available';
    raise notice 'SKIP  source_payloads_bucket_file_size_limit — storage schema not available';
  end if;
end
$$;

-- ============================================================
-- Summary
-- ============================================================

do $$
declare
  pass_count int;
  fail_count int;
begin
  select count(*) filter (where result = 'PASS'),
         count(*) filter (where result <> 'PASS')
  into pass_count, fail_count
  from _results;
  raise notice '';
  raise notice '=== SUMMARY: % passed, % failed ===', pass_count, fail_count;
  if fail_count > 0 then
    raise exception 'One or more checks failed; see FAIL notices above.';
  end if;
end
$$;

rollback;

-- ============================================================
-- CHECKS CREATED BUT NOT EXECUTED IN THIS ENVIRONMENT
-- ============================================================
--
-- The following behaviors require live capabilities not available in this
-- verification script:
--
-- A. Anon/authenticated role isolation (requires SET ROLE with superuser privilege)
--    - anon cannot SELECT from any of the six tables
--    - non-officer authenticated user cannot SELECT from any of the six tables
--    - officer authenticated user can SELECT from all six tables
--    - officer cannot INSERT or UPDATE any table (mutations are service-role server-side)
--    - officer cannot DELETE from any ingestion table
--    Run manually or via pgTAP in a test environment where SET ROLE is permitted.
--
-- B. True concurrent-worker duplicate-claim test
--    Requires two simultaneous psql connections.  The serial claim test in
--    check 10 approximates this but does not prove two concurrent workers cannot
--    each claim the same row.  Use pgbench or a test harness with parallel
--    sessions to verify FOR UPDATE SKIP LOCKED behavior.
--
-- C. source-payloads bucket is private (check 22 runs if storage schema is present)
--    After applying 0004_source_payload_bucket.sql, verify:
--    SELECT public FROM storage.buckets WHERE id = 'source-payloads';  -- expect false
--    SELECT file_size_limit FROM storage.buckets WHERE id = 'source-payloads';  -- expect 52428800
--
-- D. Service-role worker writes (INSERT on source_fetch_runs, source_payloads, etc.)
--    Requires a session authenticated as service_role to confirm inserts succeed.
--
-- E. Trigger fires for service_role (append-only enforcement)
--    The trigger applies at the database layer and cannot be bypassed by service_role.
--    Confirm by attempting an UPDATE on source_posting_versions as service_role
--    in a separate session.
