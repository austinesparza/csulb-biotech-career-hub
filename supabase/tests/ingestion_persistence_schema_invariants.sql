\set ON_ERROR_STOP on

begin;

create temp table _results (check_name text primary key, result text not null) on commit drop;

create or replace function _assert(p_name text, p_passed boolean, p_msg text default '')
returns void
language plpgsql as $$
begin
  if p_passed then
    insert into _results values (p_name, 'PASS');
    raise notice 'PASS  %', p_name;
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
  v_payload uuid;
  v_posting uuid;
  v_opp uuid;
begin
  insert into public.source_records (name, source_type)
  values ('_phase2b_sr', 'website_page')
  returning id into v_sr;

  insert into public.job_sources (source_record_id, source_name, source_kind, careers_url, enabled, terms_reviewed, terms_review_date, robots_reviewed)
  values (v_sr, 'phase2b-source', 'greenhouse', 'https://example.com/careers', true, true, current_date, true)
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
    'application/json', 200, lpad('a', 64, 'a'), 123,
    'source/test/a/a.txt'
  ) returning id into v_payload;

  begin
    insert into public.source_payloads (
      source_fetch_run_id, request_url, final_url, content_type,
      status_code, sha256, size_bytes, storage_path
    ) values (
      v_run, 'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
      'https://boards-api.greenhouse.io/v1/boards/test/jobs?content=true',
      'application/json', 200, lpad('a', 64, 'a'), 123,
      'source/test/a/a.txt'
    );
    perform _assert('source_payload_unique_rejects_duplicate', false, 'duplicate payload row was accepted');
  exception when unique_violation then
    perform _assert('source_payload_unique_rejects_duplicate', true);
  end;

  insert into public.source_postings (
    job_source_id, external_posting_id, canonical_url, identity_key,
    current_status, relevance_score, relevance_score_version,
    score_breakdown_json, uncertainty_flags, first_seen_at, last_seen_at,
    last_payload_id, last_material_hash
  ) values (
    v_js, '123', 'https://example.com/jobs/123', 'greenhouse:test:123',
    'open', 80, 1,
    '{}'::jsonb, '{}'::text[], now(), now(),
    v_payload, lpad('b', 64, 'b')
  ) returning id into v_posting;

  begin
    insert into public.source_postings (
      job_source_id, canonical_url, identity_key,
      current_status, last_material_hash
    ) values (
      v_js, 'https://example.com/jobs/123', 'greenhouse:test:123',
      'open', lpad('b', 64, 'b')
    );
    perform _assert('source_posting_identity_unique_rejects_duplicate', false, 'duplicate identity row was accepted');
  exception when unique_violation then
    perform _assert('source_posting_identity_unique_rejects_duplicate', true);
  end;

  insert into public.source_posting_versions (
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash,
    normalized_json, score_breakdown_json, field_diff_json
  ) values (
    v_posting, v_run, v_payload,
    '1.0.0', false, lpad('b', 64, 'b'),
    '{"identityKey":"greenhouse:test:123"}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  );

  begin
    update public.source_posting_versions
      set connector_version = '1.0.1'
    where source_posting_id = v_posting;
    perform _assert('source_posting_versions_update_blocked', false, 'append-only trigger failed to block update');
  exception when others then
    perform _assert('source_posting_versions_update_blocked', true);
  end;

  insert into public.opportunities (
    source_record_id, title, status, review_status, public_safe
  ) values (
    v_sr, 'Pending bridge opportunity', 'needs_review', 'pending', false
  ) returning id into v_opp;

  insert into public.opportunity_source_links (
    opportunity_id, source_posting_id, match_type, is_primary
  ) values (
    v_opp, v_posting, 'exact', true
  );

  begin
    insert into public.opportunity_source_links (
      opportunity_id, source_posting_id, match_type, is_primary
    ) values (
      v_opp, v_posting, 'exact', false
    );
    perform _assert('opportunity_source_links_unique_rejects_duplicate_pair', false, 'duplicate source link pair was accepted');
  exception when unique_violation then
    perform _assert('opportunity_source_links_unique_rejects_duplicate_pair', true);
  end;

  begin
    insert into public.opportunity_source_links (
      opportunity_id, source_posting_id, match_type, is_primary
    ) values (
      v_opp, v_posting, 'manual', true
    );
    perform _assert('opportunity_source_links_primary_unique_rejects_second_primary', false, 'second primary link was accepted');
  exception when unique_violation then
    perform _assert('opportunity_source_links_primary_unique_rejects_second_primary', true);
  end;

  perform _assert('pending_opportunity_safety_defaults',
    exists (
      select 1 from public.opportunities
      where id = v_opp
        and status = 'needs_review'
        and review_status = 'pending'
        and public_safe = false
    ),
    'pending opportunity safety flags not preserved'
  );
end
$$;

select * from _results order by check_name;

rollback;
