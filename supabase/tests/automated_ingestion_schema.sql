-- Deliverable B — schema, constraint, RLS, and privilege verification for automated ingestion.
-- Run after all migrations against a disposable/reset database.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp._assert(
  p_name text,
  p_condition boolean,
  p_detail text default null
)
returns void
language plpgsql
as $$
begin
  if coalesce(p_condition, false) then
    raise notice 'PASS  %', p_name;
  else
    raise notice 'FAIL  %  — %', p_name, coalesce(p_detail, 'condition was false');
    raise exception 'Assertion failed: %  (%)', p_name, coalesce(p_detail, 'condition was false');
  end if;
end;
$$;

-- ============================================================
-- 1. Tables exist
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads','source_postings',
    'source_posting_versions','opportunity_source_links'
  ] loop
    perform pg_temp._assert(
      'table_exists_' || t,
      to_regclass('public.' || t) is not null,
      'missing public.' || t
    );
  end loop;
end
$$;

-- ============================================================
-- 2. task_type enum extensions exist
-- ============================================================
do $$
declare
  v text;
begin
  foreach v in array array['source_new','source_changed','source_reopened','source_health'] loop
    perform pg_temp._assert(
      'task_type_enum_' || v,
      exists (
        select 1
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public'
          and t.typname = 'task_type'
          and e.enumlabel = v
      ),
      'missing task_type value ' || v
    );
  end loop;
end
$$;

-- ============================================================
-- 3. Source fetch run status constraint
-- ============================================================
do $$
begin
  begin
    insert into public.source_fetch_runs (job_source_id, run_status)
    select id, 'not-a-status'
    from public.job_sources
    limit 1;
    raise exception 'invalid status unexpectedly accepted';
  exception
    when check_violation then
      raise notice 'PASS  reject_invalid_fetch_run_status';
  end;
end
$$;

-- ============================================================
-- 4. Source posting status constraint
-- ============================================================
do $$
begin
  begin
    insert into public.source_postings (
      job_source_id, source_key, canonical_url, title, company_name, source_status
    )
    select id, 'bad-status-test', 'https://example.invalid/bad-status-test',
           'Bad Status Test', 'Example', 'not-a-status'
    from public.job_sources
    limit 1;
    raise exception 'invalid posting status unexpectedly accepted';
  exception
    when check_violation then
      raise notice 'PASS  reject_invalid_posting_status';
  end;
end
$$;

-- ============================================================
-- 5. Error class constraint
-- ============================================================
do $$
begin
  begin
    update public.job_sources
    set last_error_class = 'invalid'
    where id = (select id from public.job_sources limit 1);
    raise exception 'invalid error class unexpectedly accepted';
  exception
    when check_violation then
      raise notice 'PASS  reject_invalid_error_class';
  end;
end
$$;

-- ============================================================
-- 6. Source health checks
-- ============================================================
do $$
declare
  source_id uuid;
begin
  select id into source_id from public.job_sources limit 1;

  begin
    update public.job_sources set records_seen = -1 where id = source_id;
    raise exception 'negative records_seen unexpectedly accepted';
  exception
    when check_violation then raise notice 'PASS  reject_negative_records_seen';
  end;

  begin
    update public.job_sources set consecutive_misses = -1 where id = source_id;
    raise exception 'negative consecutive_misses unexpectedly accepted';
  exception
    when check_violation then raise notice 'PASS  reject_negative_consecutive_misses';
  end;

  begin
    update public.job_sources set consecutive_failures = -1 where id = source_id;
    raise exception 'negative consecutive_failures unexpectedly accepted';
  exception
    when check_violation then raise notice 'PASS  reject_negative_consecutive_failures';
  end;
end
$$;

-- ============================================================
-- 7. Relevance score/version pairing
-- ============================================================
do $$
declare
  source_id uuid;
  posting_id uuid;
begin
  select id into source_id from public.job_sources limit 1;
  insert into public.source_postings (
    job_source_id, source_key, canonical_url, title, company_name, source_status
  ) values (
    source_id, 'relevance-score-contract', 'https://example.invalid/relevance-score-contract',
    'Relevance Contract', 'Example', 'open'
  ) returning id into posting_id;

  begin
    update public.source_postings set relevance_score = -1, relevance_score_version = 'v1' where id = posting_id;
    raise exception 'below-range relevance score unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_relevance_score_below_range'; end;

  begin
    update public.source_postings set relevance_score = 101, relevance_score_version = 'v1' where id = posting_id;
    raise exception 'above-range relevance score unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_relevance_score_above_range'; end;

  begin
    update public.source_postings set relevance_score = 50, relevance_score_version = null where id = posting_id;
    raise exception 'score without version unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_relevance_score_without_version'; end;

  begin
    update public.source_postings set relevance_score = null, relevance_score_version = 'v1' where id = posting_id;
    raise exception 'version without score unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_relevance_score_version_without_score'; end;

  update public.source_postings set relevance_score = 50, relevance_score_version = 'v1' where id = posting_id;
  raise notice 'PASS  accept_relevance_score_with_version';
end
$$;

-- ============================================================
-- 8. HTTP status and payload-hash constraints
-- ============================================================
do $$
declare
  source_id uuid;
begin
  select id into source_id from public.job_sources limit 1;

  begin
    update public.job_sources set last_http_status = 99 where id = source_id;
    raise exception 'HTTP status below range unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_last_http_status_below_range'; end;

  begin
    update public.job_sources set last_http_status = 600 where id = source_id;
    raise exception 'HTTP status above range unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_last_http_status_above_range'; end;

  begin
    update public.job_sources set last_payload_hash = repeat('A', 64) where id = source_id;
    raise exception 'uppercase payload hash unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_last_payload_hash_uppercase'; end;

  begin
    update public.job_sources set last_payload_hash = repeat('a', 63) where id = source_id;
    raise exception 'invalid-length payload hash unexpectedly accepted';
  exception when check_violation then raise notice 'PASS  reject_last_payload_hash_invalid_length'; end;

  update public.job_sources
  set last_http_status = 200,
      last_payload_hash = repeat('a', 64),
      records_seen = 1,
      consecutive_misses = 0,
      consecutive_failures = 0
  where id = source_id;
  raise notice 'PASS  accept_source_health_fields_valid';
end
$$;

-- ============================================================
-- 9. Unique source_record_id / identity_key
-- ============================================================
do $$
declare
  source_record uuid;
begin
  insert into public.source_records (name, source_type, access_level, public_safe)
  values ('Contract source record', 'website_page', 'officers', false)
  returning id into source_record;

  insert into public.job_sources (name, source_record_id, source_type, fetch_url, identity_key)
  values ('Contract source one', source_record, 'manual', 'https://example.invalid/a', 'contract-source-1');

  begin
    insert into public.job_sources (name, source_record_id, source_type, fetch_url, identity_key)
    values ('Contract source two', source_record, 'manual', 'https://example.invalid/b', 'contract-source-2');
    raise exception 'duplicate source_record_id unexpectedly accepted';
  exception when unique_violation then raise notice 'PASS  reject_duplicate_source_record_id'; end;
end
$$;

do $$
begin
  begin
    insert into public.job_sources (name, source_type, fetch_url, identity_key)
    values ('Duplicate identity', 'manual', 'https://example.invalid/identity', 'contract-source-1');
    raise exception 'duplicate identity_key unexpectedly accepted';
  exception when unique_violation then raise notice 'PASS  reject_duplicate_identity_key'; end;
end
$$;

-- ============================================================
-- 10. Primary link uniqueness
-- ============================================================
do $$
declare
  js uuid;
  p1 uuid;
  p2 uuid;
  opp uuid;
begin
  insert into public.job_sources (name, source_type, fetch_url, identity_key)
  values ('Link source', 'manual', 'https://example.invalid/link', 'link-source')
  returning id into js;

  insert into public.source_postings (job_source_id, source_key, canonical_url, title, company_name, source_status)
  values (js, 'link-1', 'https://example.invalid/link-1', 'One', 'Example', 'open') returning id into p1;
  insert into public.source_postings (job_source_id, source_key, canonical_url, title, company_name, source_status)
  values (js, 'link-2', 'https://example.invalid/link-2', 'Two', 'Example', 'open') returning id into p2;

  insert into public.opportunities (title, status, review_status, public_safe)
  values ('Linked opportunity', 'needs_review', 'pending', false) returning id into opp;

  insert into public.opportunity_source_links (opportunity_id, source_posting_id, is_primary)
  values (opp, p1, true);

  begin
    insert into public.opportunity_source_links (opportunity_id, source_posting_id, is_primary)
    values (opp, p2, true);
    raise exception 'second primary link unexpectedly accepted';
  exception when unique_violation then raise notice 'PASS  reject_second_primary_link'; end;
end
$$;

-- ============================================================
-- 11. Version rows are append-only
-- ============================================================
do $$
declare
  js uuid;
  posting uuid;
  version_id uuid;
begin
  insert into public.job_sources (name, source_type, fetch_url, identity_key)
  values ('Version source', 'manual', 'https://example.invalid/version', 'version-source')
  returning id into js;

  insert into public.source_postings (job_source_id, source_key, canonical_url, title, company_name, source_status)
  values (js, 'version-1', 'https://example.invalid/version-1', 'Version One', 'Example', 'open')
  returning id into posting;

  insert into public.source_posting_versions (source_posting_id, payload_hash, title, company_name, source_status)
  values (posting, repeat('b', 64), 'Version One', 'Example', 'open')
  returning id into version_id;

  begin
    update public.source_posting_versions set title = 'Mutated' where id = version_id;
    raise exception 'version update unexpectedly accepted';
  exception when insufficient_privilege then raise notice 'PASS  reject_update_source_posting_versions'; end;

  begin
    delete from public.source_posting_versions where id = version_id;
    raise exception 'version delete unexpectedly accepted';
  exception when insufficient_privilege then raise notice 'PASS  reject_delete_source_posting_versions'; end;
end
$$;

-- ============================================================
-- 12. Worker claim behavior
-- ============================================================
do $$
declare
  js uuid;
  run_id uuid;
  claimed uuid;
begin
  insert into public.job_sources (name, source_type, fetch_url, identity_key, enabled, next_fetch_at)
  values ('Claim source', 'manual', 'https://example.invalid/claim', 'claim-source', true, now() - interval '1 minute')
  returning id into js;

  insert into public.source_fetch_runs (job_source_id, run_status)
  values (js, 'pending') returning id into run_id;

  select id into claimed from public.claim_next_source_fetch_run('worker-1', 1) limit 1;
  perform pg_temp._assert('claim_returns_pending_run', claimed is not null, 'expected a claimed run');
  perform pg_temp._assert('claim_returns_correct_run', claimed = run_id, 'claimed unexpected run');

  select id into claimed from public.claim_next_source_fetch_run('worker-2', 1) limit 1;
  perform pg_temp._assert('second_claim_returns_nothing', claimed is null, 'already-claimed run returned again');
end
$$;

-- ============================================================
-- 13. Paused enabled source is skipped
-- ============================================================
do $$
declare
  js uuid;
  run_id uuid;
  claimed uuid;
begin
  insert into public.job_sources (name, source_type, fetch_url, identity_key, enabled, next_fetch_at, paused_until)
  values ('Paused source', 'manual', 'https://example.invalid/paused', 'paused-source', true, now() - interval '1 minute', now() + interval '1 hour')
  returning id into js;
  raise notice 'PASS  enabled_source_can_be_paused';

  insert into public.source_fetch_runs (job_source_id, run_status)
  values (js, 'pending') returning id into run_id;

  select id into claimed from public.claim_next_source_fetch_run('worker-pause', 1) limit 1;
  perform pg_temp._assert('claim_skips_paused_enabled_source', claimed is null, 'paused source run was claimed');
end
$$;

-- ============================================================
-- 14. Claim argument validation
-- ============================================================
do $$
begin
  begin
    perform public.claim_next_source_fetch_run('', 1);
    raise exception 'empty worker id unexpectedly accepted';
  exception when invalid_parameter_value then raise notice 'PASS  claim_rejects_empty_worker_id'; end;

  begin
    perform public.claim_next_source_fetch_run(null, 1);
    raise exception 'null worker id unexpectedly accepted';
  exception when invalid_parameter_value then raise notice 'PASS  claim_rejects_null_worker_id'; end;

  begin
    perform public.claim_next_source_fetch_run('worker', 0);
    raise exception 'batch size zero unexpectedly accepted';
  exception when invalid_parameter_value then raise notice 'PASS  claim_rejects_batch_size_zero'; end;

  begin
    perform public.claim_next_source_fetch_run('worker', 51);
    raise exception 'batch size 51 unexpectedly accepted';
  exception when invalid_parameter_value then raise notice 'PASS  claim_rejects_batch_size_51'; end;

  begin
    perform public.claim_next_source_fetch_run('worker', null);
    raise exception 'null batch size unexpectedly accepted';
  exception when invalid_parameter_value then raise notice 'PASS  claim_rejects_null_batch_size'; end;
end
$$;

-- ============================================================
-- 15. RLS enabled
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads','source_postings',
    'source_posting_versions','opportunity_source_links'
  ] loop
    perform pg_temp._assert(
      'rls_enabled_' || t,
      (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass),
      'RLS disabled on ' || t
    );
  end loop;
end
$$;

-- ============================================================
-- 16. Policies and role privileges
-- ============================================================
do $$
declare
  t text;
  has_it boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads','source_postings',
    'source_posting_versions','opportunity_source_links'
  ] loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and roles @> array['authenticated']::name[]
        and cmd = 'SELECT'
    ) into has_it;
    perform pg_temp._assert('officer_select_policy_exists_' || t, has_it, 'missing officer SELECT policy');

    select exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and roles @> array['authenticated']::name[]
        and cmd in ('INSERT','UPDATE','DELETE','ALL')
    ) into has_it;
    perform pg_temp._assert('no_authenticated_mutate_policy_' || t, not has_it, 'authenticated mutation policy exists');

    select exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = t
        and cmd = 'DELETE'
    ) into has_it;
    perform pg_temp._assert('no_officer_delete_policy_' || t, not has_it, 'DELETE policy exists');
  end loop;
end
$$;

do $$
declare
  t text;
  has_it boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads','source_postings',
    'source_posting_versions','opportunity_source_links'
  ] loop
    select has_table_privilege('anon', format('public.%s', t), 'SELECT') into has_it;
    perform pg_temp._assert(format('anon_no_select_%s', t), not coalesce(has_it, false), 'anon has SELECT');
    select has_table_privilege('anon', format('public.%s', t), 'INSERT') into has_it;
    perform pg_temp._assert(format('anon_no_insert_%s', t), not coalesce(has_it, false), 'anon has INSERT');
    select has_table_privilege('anon', format('public.%s', t), 'UPDATE') into has_it;
    perform pg_temp._assert(format('anon_no_update_%s', t), not coalesce(has_it, false), 'anon has UPDATE');
    select has_table_privilege('anon', format('public.%s', t), 'DELETE') into has_it;
    perform pg_temp._assert(format('anon_no_delete_%s', t), not coalesce(has_it, false), 'anon has DELETE');
  end loop;
end
$$;

do $$
declare
  t text;
  has_it boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads','source_postings',
    'source_posting_versions','opportunity_source_links'
  ] loop
    select has_table_privilege('authenticated', format('public.%s', t), 'SELECT') into has_it;
    perform pg_temp._assert(format('authenticated_has_select_%s', t), coalesce(has_it, false), 'authenticated lacks SELECT');
    select has_table_privilege('authenticated', format('public.%s', t), 'INSERT') into has_it;
    perform pg_temp._assert(format('authenticated_no_insert_%s', t), not coalesce(has_it, false), 'authenticated has INSERT');
    select has_table_privilege('authenticated', format('public.%s', t), 'UPDATE') into has_it;
    perform pg_temp._assert(format('authenticated_no_update_%s', t), not coalesce(has_it, false), 'authenticated has UPDATE');
    select has_table_privilege('authenticated', format('public.%s', t), 'DELETE') into has_it;
    perform pg_temp._assert(format('authenticated_no_delete_%s', t), not coalesce(has_it, false), 'authenticated has DELETE');
  end loop;
end
$$;

do $$
declare
  t text;
  has_it boolean;
begin
  foreach t in array array[
    'job_sources','source_fetch_runs','source_payloads','source_postings',
    'source_posting_versions','opportunity_source_links'
  ] loop
    select has_table_privilege('service_role', format('public.%s', t), 'SELECT') into has_it;
    perform pg_temp._assert(format('service_role_select_%s', t), coalesce(has_it, false), 'service_role lacks SELECT');
    select has_table_privilege('service_role', format('public.%s', t), 'INSERT') into has_it;
    perform pg_temp._assert(format('service_role_insert_%s', t), coalesce(has_it, false), 'service_role lacks INSERT');
    select has_table_privilege('service_role', format('public.%s', t), 'UPDATE') into has_it;
    perform pg_temp._assert(format('service_role_update_%s', t), coalesce(has_it, false), 'service_role lacks UPDATE');
    select has_table_privilege('service_role', format('public.%s', t), 'DELETE') into has_it;
    perform pg_temp._assert(format('service_role_delete_%s', t), coalesce(has_it, false), 'service_role lacks DELETE');
    select has_table_privilege('service_role', format('public.%s', t), 'TRUNCATE') into has_it;
    perform pg_temp._assert(format('service_role_no_truncate_%s', t), not coalesce(has_it, false),
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
    'status','public_notes','relevance_score','last_checked_at','first_seen_at','source_name',
    'audience_bucket','audience_reason','scientific_lanes','job_functions','methods',
    'industry_context','graduate_stage','eligibility_status','eligibility_evidence',
    'continued_enrollment_required','graduation_window_start','graduation_window_end',
    'work_authorization','application_opened_at','date_basis','source_check_result',
    'discovery_route','company_website','company_location','company_industry_tags','company_description'
  ];
  actual_cols text[];
begin
  select array_agg(column_name::text order by ordinal_position)
  into actual_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'public_opportunities';

  perform pg_temp._assert(
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

  perform pg_temp._assert(
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
  exposed boolean;
begin
  select exists (
    select 1
    from information_schema.view_table_usage
    where view_schema = 'public'
      and view_name like 'public\_%' escape '\'
      and table_schema = 'public'
      and table_name in (
        'job_sources','source_fetch_runs','source_payloads','source_postings',
        'source_posting_versions','opportunity_source_links'
      )
  ) into exposed;
  perform pg_temp._assert(
    'no_ingestion_table_exposed_by_public_view',
    not exposed,
    'a public_* view directly references an ingestion table'
  );
end
$$;

rollback;
