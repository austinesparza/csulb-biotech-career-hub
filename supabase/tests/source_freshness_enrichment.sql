\set ON_ERROR_STOP on

begin;

create temp table _freshness_results (
  check_name text primary key,
  result text not null
) on commit drop;

create or replace function pg_temp._freshness_assert(
  p_name text,
  p_passed boolean,
  p_message text default ''
)
returns void
language plpgsql
as $$
begin
  if p_passed then
    insert into _freshness_results values (p_name, 'PASS');
  else
    insert into _freshness_results values (p_name, 'FAIL: ' || p_message);
    raise exception 'Assertion failed: % (%)', p_name, p_message;
  end if;
end;
$$;

do $$
declare
  v_source_record uuid;
  v_company uuid;
  v_job_source uuid;
  v_run1 uuid;
  v_run2 uuid;
  v_run3 uuid;
  v_payload1 uuid;
  v_payload2 uuid;
  v_payload3 uuid;
  v_approved_posting uuid;
  v_pending_posting uuid;
  v_approved_opportunity uuid;
  v_pending_opportunity uuid;
  v_row record;
begin
  perform pg_temp._freshness_assert(
    'paid_status_detects_hourly_range',
    public.infer_source_paid_status('The base pay range for this opportunity is $35.34-$41.20/hour.') = 'paid',
    'explicit employer pay range was not classified paid'
  );

  perform pg_temp._freshness_assert(
    'paid_status_ignores_unpaid_benefit_phrase',
    public.infer_source_paid_status('Benefits include paid holidays and unpaid time off.') = 'unknown',
    'generic unpaid-benefit language must not classify the role unpaid'
  );

  perform pg_temp._freshness_assert(
    'timing_extracts_term_and_duration',
    public.extract_source_program_timing(
      'Grad Intern - Summer 2027',
      'The internship is approximately 13 weeks and includes a capstone presentation.'
    ) = 'Summer 2027 (approximately 13 weeks)',
    'season/year plus explicit duration should be preserved without inference'
  );

  perform pg_temp._freshness_assert(
    'timing_extracts_exact_date_range',
    public.extract_source_program_timing(
      'Technology 2027 Fall Co-Op',
      'Candidates must be available June 21 through December 17, 2027 for the full program.'
    ) = 'June 21 through December 17, 2027',
    'explicit date range should win over broad term text'
  );

  insert into public.source_records(name, source_type, public_safe)
  values ('_freshness_test_source', 'website_page', false)
  returning id into v_source_record;

  insert into public.companies(name, name_normalized, public_safe)
  values ('_freshness_test_company', '_freshness_test_company', false)
  returning id into v_company;

  insert into public.job_sources(
    source_record_id, company_id, source_name, source_kind, careers_url,
    enabled, terms_reviewed, terms_review_date, robots_reviewed
  ) values (
    v_source_record, v_company, '_freshness_test_source', 'greenhouse',
    'https://example.org/careers', true, true, current_date, true
  ) returning id into v_job_source;

  insert into public.source_fetch_runs(
    job_source_id, trigger_kind, status, scheduled_for, started_at
  ) values (
    v_job_source, 'manual', 'running', '2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z'
  ) returning id into v_run1;

  insert into public.source_payloads(
    source_fetch_run_id, request_url, final_url, content_type, status_code,
    sha256, size_bytes, storage_path
  ) values (
    v_run1, 'https://example.org/api/jobs', 'https://example.org/api/jobs',
    'application/json', 200, repeat('a', 64), 100, '_freshness/a.json'
  ) returning id into v_payload1;

  insert into public.source_postings(
    job_source_id, canonical_url, identity_key, title_raw, title_normalized,
    employment_type, classification, current_status, relevance_score,
    relevance_score_version, last_payload_id, last_material_hash,
    first_seen_at, last_seen_at
  ) values (
    v_job_source, 'https://example.org/jobs/approved', 'greenhouse:freshness:approved',
    'Approved Summer 2027 Intern', 'approved summer 2027 intern',
    'Internship', 'internship', 'open', 90, 3, v_payload1, repeat('b', 64),
    '2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z'
  ) returning id into v_approved_posting;

  insert into public.source_posting_versions(
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash, normalized_json
  ) values (
    v_approved_posting, v_run1, v_payload1, 'test/1.0.0', true, repeat('b', 64),
    jsonb_build_object(
      'titleRaw', 'Approved Summer 2027 Intern',
      'descriptionText', 'Summer 2027 program is approximately 12 weeks. Base pay range is $30-$35/hour.'
    )
  );

  insert into public.opportunities(
    company_id, source_record_id, title, posting_url, status, review_status,
    public_safe, paid_status, public_notes, start_date_text,
    last_checked_at, first_seen_at, last_seen_at
  ) values (
    v_company, v_source_record, 'Approved Summer 2027 Intern',
    'https://example.org/jobs/approved', 'open_verified', 'approved', true,
    'unknown', 'Officer-curated note', 'Officer-curated timing',
    '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
  ) returning id into v_approved_opportunity;

  insert into public.opportunity_source_links(
    opportunity_id, source_posting_id, match_type, is_primary
  ) values (v_approved_opportunity, v_approved_posting, 'exact', true);

  select * into v_row from public.opportunities where id = v_approved_opportunity;
  perform pg_temp._freshness_assert(
    'approved_link_refreshes_observation_metadata',
    v_row.last_checked_at = '2026-09-13T10:00:00Z'::timestamptz
      and v_row.source_check_result = 'open',
    'approved record did not inherit current primary-source observation metadata'
  );
  perform pg_temp._freshness_assert(
    'approved_link_preserves_curated_content',
    v_row.public_notes = 'Officer-curated note'
      and v_row.start_date_text = 'Officer-curated timing'
      and v_row.paid_status = 'unknown',
    'machine evidence overwrote officer-curated public content'
  );

  insert into public.source_postings(
    job_source_id, canonical_url, identity_key, title_raw, title_normalized,
    employment_type, classification, current_status, relevance_score,
    relevance_score_version, last_payload_id, last_material_hash,
    first_seen_at, last_seen_at
  ) values (
    v_job_source, 'https://example.org/jobs/pending', 'greenhouse:freshness:pending',
    'Grad Intern - Summer 2027', 'grad intern summer 2027',
    'Internship', 'internship', 'open', 85, 3, v_payload1, repeat('c', 64),
    '2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z'
  ) returning id into v_pending_posting;

  insert into public.source_posting_versions(
    source_posting_id, source_fetch_run_id, source_payload_id,
    connector_version, is_material_change, material_hash, normalized_json
  ) values (
    v_pending_posting, v_run1, v_payload1, 'test/1.0.0', true, repeat('c', 64),
    jsonb_build_object(
      'titleRaw', 'Grad Intern - Summer 2027',
      'descriptionText', 'This Summer 2027 internship is approximately 13 weeks. The base pay range for this opportunity is $35.34-$41.20/hour.'
    )
  );

  insert into public.opportunities(
    company_id, source_record_id, title, posting_url, status, review_status,
    public_safe, paid_status, first_seen_at, last_seen_at
  ) values (
    v_company, v_source_record, 'Grad Intern - Summer 2027',
    'https://example.org/jobs/pending', 'needs_review', 'pending', false,
    'unknown', '2026-09-13T10:00:00Z', '2026-09-13T10:00:00Z'
  ) returning id into v_pending_opportunity;

  insert into public.opportunity_source_links(
    opportunity_id, source_posting_id, match_type, is_primary
  ) values (v_pending_opportunity, v_pending_posting, 'exact', true);

  select * into v_row from public.opportunities where id = v_pending_opportunity;
  perform pg_temp._freshness_assert(
    'pending_link_enriches_source_evidence',
    v_row.paid_status = 'paid'
      and v_row.public_notes ilike '%$35.34-$41.20/hour%'
      and v_row.start_date_text = 'Summer 2027 (approximately 13 weeks)'
      and v_row.discovery_route = 'official_feed',
    'pending opportunity did not receive authoritative pay/timing enrichment'
  );

  -- First complete inventory after both postings were last seen. Neither appears
  -- in this inventory, so the system should flag but not unpublish.
  insert into public.source_fetch_runs(
    job_source_id, trigger_kind, status, scheduled_for, started_at
  ) values (
    v_job_source, 'scheduled', 'running', '2026-09-13T12:00:00Z', '2026-09-13T12:00:00Z'
  ) returning id into v_run2;

  insert into public.source_payloads(
    source_fetch_run_id, request_url, final_url, content_type, status_code,
    sha256, size_bytes, storage_path
  ) values (
    v_run2, 'https://example.org/api/jobs', 'https://example.org/api/jobs',
    'application/json', 200, repeat('d', 64), 100, '_freshness/d.json'
  ) returning id into v_payload2;

  update public.source_fetch_runs
  set status = 'completed', finished_at = '2026-09-13T12:05:00Z',
      http_status = 200, payload_count = 1, log_json = '{}'::jsonb
  where id = v_run2;

  select * into v_row from public.source_postings where id = v_approved_posting;
  perform pg_temp._freshness_assert(
    'first_inventory_miss_is_candidate_only',
    v_row.current_status = 'closure_candidate'
      and v_row.consecutive_misses = 1
      and v_row.closure_confidence = 0.50,
    'first complete-feed miss should accumulate evidence, not close the record'
  );

  select * into v_row from public.opportunities where id = v_approved_opportunity;
  perform pg_temp._freshness_assert(
    'missing_source_does_not_unpublish',
    v_row.review_status = 'approved'
      and v_row.public_safe
      and v_row.status = 'open_verified'
      and v_row.source_check_result = 'missing',
    'missing-source evidence must not silently change publication state'
  );

  perform pg_temp._freshness_assert(
    'missing_source_queues_officer_review',
    exists(
      select 1 from public.review_tasks
      where task_type = 'stale_record'
        and entity_table = 'opportunities'
        and entity_id = v_approved_opportunity
        and status = 'open'
    ),
    'approved opportunity missing from primary feed did not create stale_record task'
  );

  perform pg_temp._freshness_assert(
    'run_counts_closure_candidates',
    (select records_closed_candidates from public.source_fetch_runs where id = v_run2) = 2,
    'completed run did not report absent postings'
  );

  -- A second complete miss moves the source posting to missing, still without
  -- changing curated publication state.
  insert into public.source_fetch_runs(
    job_source_id, trigger_kind, status, scheduled_for, started_at
  ) values (
    v_job_source, 'scheduled', 'running', '2026-09-13T13:00:00Z', '2026-09-13T13:00:00Z'
  ) returning id into v_run3;

  insert into public.source_payloads(
    source_fetch_run_id, request_url, final_url, content_type, status_code,
    sha256, size_bytes, storage_path
  ) values (
    v_run3, 'https://example.org/api/jobs', 'https://example.org/api/jobs',
    'application/json', 200, repeat('e', 64), 100, '_freshness/e.json'
  ) returning id into v_payload3;

  update public.source_fetch_runs
  set status = 'completed', finished_at = '2026-09-13T13:05:00Z',
      http_status = 200, payload_count = 1, log_json = '{}'::jsonb
  where id = v_run3;

  select * into v_row from public.source_postings where id = v_approved_posting;
  perform pg_temp._freshness_assert(
    'second_inventory_miss_marks_source_missing',
    v_row.current_status = 'missing'
      and v_row.consecutive_misses = 2
      and v_row.closure_confidence = 0.85,
    'second complete-feed miss should promote source evidence to missing'
  );

  -- Reappearance resets miss history and refreshes observational metadata.
  update public.source_postings
  set current_status = 'reopened', last_seen_at = '2026-09-13T14:00:00Z'
  where id = v_approved_posting;

  select * into v_row from public.source_postings where id = v_approved_posting;
  perform pg_temp._freshness_assert(
    'reappearance_resets_miss_evidence',
    v_row.current_status = 'reopened'
      and v_row.consecutive_misses = 0
      and v_row.closure_confidence = 0,
    'reappearing source posting retained stale miss counters'
  );

  select * into v_row from public.opportunities where id = v_approved_opportunity;
  perform pg_temp._freshness_assert(
    'reappearance_refreshes_approved_source_check',
    v_row.last_checked_at = '2026-09-13T14:00:00Z'::timestamptz
      and v_row.source_check_result = 'open'
      and v_row.public_notes = 'Officer-curated note',
    'reappearance did not refresh metadata or altered curated content'
  );
end
$$;

select * from _freshness_results order by check_name;
rollback;
