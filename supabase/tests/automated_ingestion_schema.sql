-- automated_ingestion_schema.sql
-- Verification script for Phase 1 automated ingestion schema.
-- All checks run inside a single transaction that is rolled back at the end,
-- so this script is safe to run against any disposable test database after
-- applying 0001_init.sql, 0002_ingestion_task_types.sql, and 0003_automated_ingestion_schema.sql.
-- (0004_source_payload_bucket.sql requires a live Supabase project; see footer.)
--
-- How to run locally:
--   supabase start                                  # starts local Supabase stack
--   supabase db push                                # applies all migrations
--   psql "$DATABASE_URL" -f supabase/tests/automated_ingestion_schema.sql
--
-- If no local Supabase is available, these checks were CREATED but NOT EXECUTED.
-- See the footer for the full list of untested items.
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
-- 3. Invalid statuses are rejected
-- ============================================================

-- source_fetch_runs.status
do $$
begin
  begin
    insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
    values (gen_random_uuid(), 'scheduled', 'bogus_status', now());
    perform _assert('reject_invalid_fetch_run_status', false, 'invalid status was accepted');
  exception when check_violation then
    perform _assert('reject_invalid_fetch_run_status', true);
  end;
end
$$;

-- source_postings.current_status
do $$
begin
  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash, current_status
    ) values (gen_random_uuid(), 'https://example.com', 'key1', 'hash1', 'not_a_status');
    perform _assert('reject_invalid_posting_status', false, 'invalid status was accepted');
  exception when check_violation then
    perform _assert('reject_invalid_posting_status', true);
  end;
end
$$;

-- source_fetch_runs.error_class
do $$
begin
  begin
    insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, error_class)
    values (gen_random_uuid(), 'manual', 'completed', now(), 'mystery_error');
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
begin
  begin
    insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for, records_seen)
    values (gen_random_uuid(), 'scheduled', 'pending', now(), -1);
    perform _assert('reject_negative_records_seen', false, 'negative counter was accepted');
  exception when check_violation then
    perform _assert('reject_negative_records_seen', true);
  end;
end
$$;

do $$
begin
  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key, last_material_hash, consecutive_misses
    ) values (gen_random_uuid(), 'https://example.com', 'key2', 'hash2', -5);
    perform _assert('reject_negative_consecutive_misses', false, 'negative counter was accepted');
  exception when check_violation then
    perform _assert('reject_negative_consecutive_misses', true);
  end;
end
$$;

do $$
begin
  begin
    insert into public.job_sources (
      source_record_id, source_name, source_kind, careers_url, consecutive_failures
    ) values (gen_random_uuid(), 'test', 'rss', 'https://example.com', -1);
    perform _assert('reject_negative_consecutive_failures', false, 'negative counter was accepted');
  exception when check_violation then
    perform _assert('reject_negative_consecutive_failures', true);
  end;
end
$$;

-- ============================================================
-- 5. Duplicate source_record_id is rejected in job_sources
-- ============================================================

do $$
declare
  v_sr_id uuid;
  v_company_id uuid;
begin
  -- Seed a minimal source_records row.
  insert into public.source_records (name, source_type)
  values ('test-sr-dup', 'website_page')
  returning id into v_sr_id;

  -- First insert should succeed.
  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'first', 'rss', 'https://example.com');

  -- Second insert with same source_record_id should fail.
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

  insert into public.source_postings (job_source_id, canonical_url, identity_key, last_material_hash)
  values (v_js_id, 'https://boards.greenhouse.io/test/1', 'job-1', 'hash-a');

  begin
    insert into public.source_postings (job_source_id, canonical_url, identity_key, last_material_hash)
    values (v_js_id, 'https://boards.greenhouse.io/test/1-dup', 'job-1', 'hash-b');
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
  returning id into v_opp_id;  -- reuse variable temporarily

  insert into public.opportunities (company_id, title, source_record_id)
  select v_opp_id, 'Test Opp', null
  returning id into v_opp_id;

  insert into public.source_records (name, source_type)
  values ('test-sr-links', 'website_page')
  returning id into v_sr_id;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url)
  values (v_sr_id, 'test-js-links', 'lever', 'https://jobs.lever.co/test')
  returning id into v_js_id;

  insert into public.source_postings (job_source_id, canonical_url, identity_key, last_material_hash)
  values (v_js_id, 'https://jobs.lever.co/test/1', 'posting-1', 'h1')
  returning id into v_sp1_id;

  insert into public.source_postings (job_source_id, canonical_url, identity_key, last_material_hash)
  values (v_js_id, 'https://jobs.lever.co/test/2', 'posting-2', 'h2')
  returning id into v_sp2_id;

  insert into public.opportunity_source_links (opportunity_id, source_posting_id, match_type, is_primary)
  values (v_opp_id, v_sp1_id, 'exact', true);

  begin
    insert into public.opportunity_source_links (opportunity_id, source_posting_id, match_type, is_primary)
    values (v_opp_id, v_sp2_id, 'exact', true);
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
  ) values (v_sfr_id, 'https://example.com/feed', 'abc123', 1024, 'source-payloads/test.json')
  returning id into v_pay_id;

  insert into public.source_postings (job_source_id, canonical_url, identity_key, last_material_hash)
  values (v_js_id, 'https://example.com/job/1', 'immut-key', 'h-immut')
  returning id into v_sp_id;

  insert into public.source_posting_versions (
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash, normalized_json
  ) values (v_sp_id, v_sfr_id, v_pay_id, '1.0.0', true, 'h-immut', '{}')
  returning id into v_spv_id;

  begin
    update public.source_posting_versions
       set connector_version = '1.0.1'
     where id = v_spv_id;
    perform _assert('reject_update_source_posting_versions', false, 'UPDATE was accepted');
  exception when others then
    perform _assert('reject_update_source_posting_versions', true);
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
  ) values (v_sfr_id, 'https://example.com/feed2', 'def456', 512, 'source-payloads/test2.json')
  returning id into v_pay_id;

  insert into public.source_postings (job_source_id, canonical_url, identity_key, last_material_hash)
  values (v_js_id, 'https://example.com/job/2', 'nodeltkey', 'h-nodelt')
  returning id into v_sp_id;

  insert into public.source_posting_versions (
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash, normalized_json
  ) values (v_sp_id, v_sfr_id, v_pay_id, '1.0.0', true, 'h-nodelt', '{}')
  returning id into v_spv_id;

  begin
    delete from public.source_posting_versions where id = v_spv_id;
    perform _assert('reject_delete_source_posting_versions', false, 'DELETE was accepted');
  exception when others then
    perform _assert('reject_delete_source_posting_versions', true);
  end;
end
$$;

-- ============================================================
-- 10. Queue claims do not return the same run twice (concurrent-worker simulation)
-- ============================================================
-- Two consecutive claims from different "workers" in the same session (serial,
-- not truly concurrent) verify that a claimed run is not re-claimable.
-- True concurrent-worker isolation requires separate sessions; that test is noted
-- in the UNTESTED section below.

do $$
declare
  v_sr_id  uuid;
  v_js_id  uuid;
  v_run_id uuid;
  v_a_id   uuid;
  v_b_id   uuid;
begin
  -- Seed an enabled job_sources row with all policy requirements met.
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

  -- Single pending run scheduled in the past.
  insert into public.source_fetch_runs (job_source_id, trigger_kind, status, scheduled_for)
  values (v_js_id, 'scheduled', 'pending', now() - interval '1 minute')
  returning id into v_run_id;

  -- First claim should return the run.
  select id into v_a_id from public.claim_source_fetch_runs('worker-A', 1);
  perform _assert('claim_returns_pending_run', v_a_id is not null,
                  'first claim returned no rows');
  perform _assert('claim_returns_correct_run', v_a_id = v_run_id,
                  format('expected %s, got %s', v_run_id, v_a_id));

  -- Second claim should return nothing (run is now running).
  select id into v_b_id from public.claim_source_fetch_runs('worker-B', 1);
  perform _assert('second_claim_returns_nothing', v_b_id is null,
                  'second claim returned a row that should already be claimed');
end
$$;

-- ============================================================
-- 11. Validate function input guardrails
-- ============================================================

do $$
begin
  begin
    perform public.claim_source_fetch_runs('', 1);
    perform _assert('claim_rejects_empty_worker_id', false, 'empty worker_id was accepted');
  exception when others then
    perform _assert('claim_rejects_empty_worker_id', true);
  end;
end
$$;

do $$
begin
  begin
    perform public.claim_source_fetch_runs(null, 1);
    perform _assert('claim_rejects_null_worker_id', false, 'null worker_id was accepted');
  exception when others then
    perform _assert('claim_rejects_null_worker_id', true);
  end;
end
$$;

-- ============================================================
-- 12–16. RLS permission checks
-- NOTE: These checks require SET ROLE and can only be executed if the test
-- session has the SUPERUSER or CREATEROLE privilege.  When running as a
-- non-privileged user (e.g. default Supabase anon/service_role), the SET ROLE
-- statements will fail.  See UNTESTED section at the bottom for the full list.
-- ============================================================

-- These checks verify the schema (RLS enabled, policies present) without
-- switching roles, since role-switching requires elevated privileges.

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

-- Verify officer SELECT policies exist for all six tables.
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

-- Verify officer INSERT policy exists for job_sources only (not others).
do $$
declare
  pol_exists boolean;
  t text;
begin
  select exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_sources'
      and policyname = 'officer_insert_job_sources'
      and cmd = 'INSERT'
  ) into pol_exists;
  perform _assert('officer_insert_policy_exists_job_sources', pol_exists,
                  'officer_insert_job_sources policy missing');

  -- None of the other five tables should have an INSERT policy for authenticated.
  foreach t in array array[
    'source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd = 'INSERT'
        and roles @> array['authenticated']::name[]
    ) into pol_exists;
    perform _assert(format('no_officer_insert_policy_%s', t), not pol_exists,
                    format('unexpected INSERT policy for authenticated on %s', t));
  end loop;
end
$$;

-- Verify officer UPDATE policy exists for job_sources only (not others).
do $$
declare
  pol_exists boolean;
  t text;
begin
  select exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'job_sources'
      and policyname = 'officer_update_job_sources'
      and cmd = 'UPDATE'
  ) into pol_exists;
  perform _assert('officer_update_policy_exists_job_sources', pol_exists,
                  'officer_update_job_sources policy missing');

  -- No UPDATE policy for authenticated on the other five tables.
  foreach t in array array[
    'source_fetch_runs','source_payloads',
    'source_postings','source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd = 'UPDATE'
        and roles @> array['authenticated']::name[]
    ) into pol_exists;
    perform _assert(format('no_officer_update_policy_%s', t), not pol_exists,
                    format('unexpected UPDATE policy for authenticated on %s', t));
  end loop;
end
$$;

-- No DELETE policy for authenticated on any of the six tables.
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
-- 17. Existing public view columns remain unchanged
-- ============================================================

do $$
declare
  expected_cols text[] := array[
    'id','company_name','title','posting_url','location','eligibility','focus_area',
    'deadline','deadline_text','start_date_text','paid_status','application_type',
    'status','public_notes','relevance_score','last_checked_at','first_seen_at','source_name'
  ];
  col text;
  col_exists boolean;
begin
  foreach col in array expected_cols loop
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'public_opportunities'
        and column_name  = col
    ) into col_exists;
    perform _assert(format('public_opportunities_col_%s', col), col_exists,
                    format('column %s missing from public_opportunities view', col));
  end loop;
end
$$;

-- ============================================================
-- 18. No ingestion table appears in information_schema without RLS
--     (belt-and-suspenders: already covered by check 12, kept for clarity)
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
    -- relrowsecurity was checked in block 12; this checks force_rls is not required
    -- (service_role must bypass RLS, so force should be false).
    perform _assert(format('rls_not_forced_%s', t), not coalesce(force_rls, false),
                    format('FORCE ROW SECURITY is set on %s — service_role would be blocked', t));
  end loop;
end
$$;

-- ============================================================
-- 19. claim_source_fetch_runs EXECUTE is restricted to service_role
-- ============================================================

do $$
declare
  can_public    boolean;
  can_anon      boolean;
  can_authed    boolean;
  can_svc       boolean;
begin
  -- Check has_function_privilege for the three roles that must NOT have EXECUTE.
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
      and tgenabled = 'O'  -- 'O' = always (origin and local)
  ) into trig_exists;
  perform _assert('append_only_trigger_exists', trig_exists,
                  'trg_source_posting_versions_append_only not found or disabled');
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
-- A. Anon/authenticated role isolation (requires SET ROLE)
--    - anon cannot SELECT from any of the six tables
--    - non-officer authenticated user cannot SELECT from any of the six tables
--    - officer authenticated user can SELECT from all six tables
--    - officer can INSERT job_sources
--    - officer can UPDATE job_sources
--    - officer cannot INSERT source_fetch_runs, source_payloads, source_postings,
--      source_posting_versions, or opportunity_source_links
--    - officer cannot DELETE from job_sources
--    These require switching to the anon/authenticated roles via SET ROLE,
--    which requires SUPERUSER privilege.  Run manually or via pgTAP in a
--    test environment where set_config('role', ...) is available.
--
-- B. True concurrent-worker duplicate-claim test
--    Requires two simultaneous psql connections.  The serial claim test in
--    check 10 above approximates this but does not prove two concurrent
--    workers cannot each claim the same row.  Use pgbench or a test harness
--    with parallel sessions to verify FOR UPDATE SKIP LOCKED behavior.
--
-- C. source-payloads bucket is private
--    Requires a live Supabase project with 0004_source_payload_bucket.sql
--    applied.  After applying, verify in the Supabase Dashboard → Storage →
--    source-payloads that the bucket shows "Private" and no public access.
--    Or: SELECT public FROM storage.buckets WHERE id = 'source-payloads';
--    → should return false.
--
-- D. Service-role worker writes (INSERT on source_fetch_runs, source_payloads, etc.)
--    Requires a session authenticated as service_role to confirm inserts succeed.
--
-- E. Trigger fires for service_role (append-only enforcement)
--    The trigger function applies at the database layer and cannot be bypassed
--    by service_role.  Confirm by attempting an UPDATE on source_posting_versions
--    as service_role in a separate session.
