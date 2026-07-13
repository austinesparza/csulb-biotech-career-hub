-- Phase 2B persistence/concurrency hardening.
-- Additive only: does not modify migrations 0001-0004.

create unique index if not exists idx_review_tasks_open_entity_marker
  on public.review_tasks(task_type, entity_table, entity_id, notes)
  where status = 'open';

create unique index if not exists idx_source_posting_versions_posting_material
  on public.source_posting_versions(source_posting_id, material_hash);

create or replace function public.upsert_source_posting_observation(
  p_fetch_run_id uuid,
  p_job_source_id uuid,
  p_identity_key text,
  p_canonical_url text,
  p_external_posting_id text,
  p_employer_name_raw text,
  p_employer_name_normalized text,
  p_title_raw text,
  p_title_normalized text,
  p_location_raw text,
  p_location_normalized text,
  p_remote_type text,
  p_employment_type text,
  p_classification text,
  p_department text,
  p_focus_area text,
  p_posted_at date,
  p_closes_at date,
  p_deadline_kind text,
  p_current_status text,
  p_relevance_score integer,
  p_relevance_score_version smallint,
  p_score_breakdown_json jsonb,
  p_uncertainty_flags text[],
  p_last_payload_id uuid,
  p_last_material_hash text,
  p_observed_at timestamptz
)
returns table (
  posting_id uuid,
  job_source_id uuid,
  identity_key text,
  canonical_url text,
  current_status text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  last_material_hash text,
  relevance_score integer,
  relevance_score_version smallint,
  created boolean,
  material_changed boolean,
  reopened boolean,
  stale_observation boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_posting public.source_postings%rowtype;
  v_existing public.source_postings%rowtype;
  v_run public.source_fetch_runs%rowtype;
  v_created boolean := false;
  v_material_changed boolean := false;
  v_reopened boolean := false;
  v_stale boolean := false;
begin
  select * into v_run
  from public.source_fetch_runs
  where id = p_fetch_run_id
  for update;

  if v_run.id is null then
    raise exception 'upsert_source_posting_observation: fetch run not found: %', p_fetch_run_id;
  end if;
  if v_run.job_source_id <> p_job_source_id then
    raise exception 'upsert_source_posting_observation: fetch run source mismatch';
  end if;
  if v_run.status <> 'running' then
    raise exception 'upsert_source_posting_observation: fetch run % is not running', p_fetch_run_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_job_source_id::text || ':' || p_identity_key));

  select * into v_existing
  from public.source_postings
  where job_source_id = p_job_source_id
    and identity_key = p_identity_key
  for update;

  if v_existing.id is null then
    v_created := true;
    v_material_changed := true;

    insert into public.source_postings (
      job_source_id,
      identity_key,
      canonical_url,
      external_posting_id,
      employer_name_raw,
      employer_name_normalized,
      title_raw,
      title_normalized,
      location_raw,
      location_normalized,
      remote_type,
      employment_type,
      classification,
      department,
      focus_area,
      posted_at,
      closes_at,
      deadline_kind,
      current_status,
      relevance_score,
      relevance_score_version,
      score_breakdown_json,
      uncertainty_flags,
      first_seen_at,
      last_seen_at,
      last_payload_id,
      last_material_hash,
      consecutive_misses
    ) values (
      p_job_source_id,
      p_identity_key,
      p_canonical_url,
      p_external_posting_id,
      p_employer_name_raw,
      p_employer_name_normalized,
      p_title_raw,
      p_title_normalized,
      p_location_raw,
      p_location_normalized,
      p_remote_type,
      p_employment_type,
      p_classification,
      p_department,
      p_focus_area,
      p_posted_at,
      p_closes_at,
      p_deadline_kind,
      p_current_status,
      p_relevance_score,
      p_relevance_score_version,
      coalesce(p_score_breakdown_json, '{}'::jsonb),
      coalesce(p_uncertainty_flags, '{}'::text[]),
      p_observed_at,
      p_observed_at,
      p_last_payload_id,
      p_last_material_hash,
      0
    )
    returning * into v_posting;
  else
    if p_observed_at < v_existing.last_seen_at then
      v_stale := true;
      v_posting := v_existing;
      v_material_changed := false;
      v_reopened := false;
    else
      v_material_changed := v_existing.last_material_hash is distinct from p_last_material_hash;
      v_reopened := v_existing.current_status in ('closed', 'missing', 'closure_candidate') and p_current_status in ('open', 'reopened');

      update public.source_postings
      set canonical_url = p_canonical_url,
          external_posting_id = p_external_posting_id,
          employer_name_raw = p_employer_name_raw,
          employer_name_normalized = p_employer_name_normalized,
          title_raw = p_title_raw,
          title_normalized = p_title_normalized,
          location_raw = p_location_raw,
          location_normalized = p_location_normalized,
          remote_type = p_remote_type,
          employment_type = p_employment_type,
          classification = p_classification,
          department = p_department,
          focus_area = p_focus_area,
          posted_at = p_posted_at,
          closes_at = p_closes_at,
          deadline_kind = p_deadline_kind,
          current_status = p_current_status,
          relevance_score = p_relevance_score,
          relevance_score_version = p_relevance_score_version,
          score_breakdown_json = coalesce(p_score_breakdown_json, '{}'::jsonb),
          uncertainty_flags = coalesce(p_uncertainty_flags, '{}'::text[]),
          last_seen_at = p_observed_at,
          last_payload_id = p_last_payload_id,
          last_material_hash = case when p_observed_at >= v_existing.last_seen_at then p_last_material_hash else v_existing.last_material_hash end,
          consecutive_misses = 0
      where id = v_existing.id
      returning * into v_posting;
    end if;
  end if;

  posting_id := v_posting.id;
  job_source_id := v_posting.job_source_id;
  identity_key := v_posting.identity_key;
  canonical_url := v_posting.canonical_url;
  current_status := v_posting.current_status;
  first_seen_at := v_posting.first_seen_at;
  last_seen_at := v_posting.last_seen_at;
  last_material_hash := v_posting.last_material_hash;
  relevance_score := v_posting.relevance_score;
  relevance_score_version := v_posting.relevance_score_version;
  created := v_created;
  material_changed := v_material_changed;
  reopened := v_reopened;
  stale_observation := v_stale;

  return next;
end;
$$;

grant execute on function public.upsert_source_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, date, date, text, text, integer, smallint, jsonb, text[], uuid, text, timestamptz
) to service_role;
