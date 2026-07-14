-- Phase 2B integrity corrections.
-- Additive only: does not modify migrations 0001-0005.
--
-- Changes:
--   1. Drop the global (source_posting_id, material_hash) unique index that
--      incorrectly suppresses A → B → A version history.
--   2. Add an idempotency-key index keyed by (source_posting_id, source_fetch_run_id)
--      so the same run can never duplicate a version, but different runs can record
--      the same hash independently.
--   3. Add a helper _jsonb_field_diff() function for the new RPC.
--   4. Replace upsert_source_posting_observation with persist_posting_observation,
--      which handles posting upsert + version insert + review-task creation in a
--      single database transaction.
--   5. Add create_pending_opportunity, which uses a pg_advisory_xact_lock to
--      prevent duplicate pending opportunities when concurrent runs race.
--   6. Revoke execute on both old and new RPCs from public / anon / authenticated.
--      Grant execute on the new RPCs only to service_role.

-- ─── 1. Fix version idempotency key ─────────────────────────────────────────

drop index if exists public.idx_source_posting_versions_posting_material;

create unique index if not exists idx_source_posting_versions_posting_run
  on public.source_posting_versions(source_posting_id, source_fetch_run_id);

-- ─── 2. Field-diff helper ────────────────────────────────────────────────────

-- Computes a flat-key diff between two JSONB objects, returning
-- { "field": { "before": <old>, "after": <new> } } for every key whose value
-- differs (or is present only on one side).
create or replace function public._jsonb_field_diff(p_old jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable parallel safe
security invoker
set search_path = pg_temp
as $$
declare
  v_result  jsonb := '{}'::jsonb;
  v_key     text;
  v_old_val jsonb;
  v_new_val jsonb;
  v_keys    text[];
begin
  select array_agg(distinct k)
  into v_keys
  from (
    select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as k
    union
    select jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) as k
  ) all_keys;

  foreach v_key in array coalesce(v_keys, '{}')
  loop
    v_old_val := coalesce(p_old->v_key, 'null'::jsonb);
    v_new_val := coalesce(p_new->v_key, 'null'::jsonb);
    if v_old_val <> v_new_val then
      v_result := v_result || jsonb_build_object(
        v_key,
        jsonb_build_object('before', v_old_val, 'after', v_new_val)
      );
    end if;
  end loop;

  return v_result;
end;
$$;

-- ─── 3. Atomic observation RPC ───────────────────────────────────────────────

-- persist_posting_observation performs posting upsert + version insertion +
-- review-task creation in a single transaction.
--
-- Idempotency guarantees:
--   - Same fetch run replayed: posting update is a no-op (stale or same hash),
--     version insert hits ON CONFLICT DO NOTHING, task insert hits ON CONFLICT DO NOTHING.
--   - A → B → A across three runs: each run produces its own version row because
--     the unique key is (source_posting_id, source_fetch_run_id), not material_hash.
create or replace function public.persist_posting_observation(
  -- fetch-run context
  p_fetch_run_id          uuid,
  p_job_source_id         uuid,
  -- posting identity
  p_identity_key          text,
  p_canonical_url         text,
  p_external_posting_id   text,
  -- employer
  p_employer_name_raw     text,
  p_employer_name_normalized text,
  -- title
  p_title_raw             text,
  p_title_normalized      text,
  -- location
  p_location_raw          text,
  p_location_normalized   text,
  -- classification
  p_remote_type           text,
  p_employment_type       text,
  p_classification        text,
  p_department            text,
  p_focus_area            text,
  -- dates
  p_posted_at             date,
  p_closes_at             date,
  p_deadline_kind         text,
  -- status
  p_current_status        text,
  -- score
  p_relevance_score       integer,
  p_relevance_score_version smallint,
  p_score_breakdown_json  jsonb,
  p_uncertainty_flags     text[],
  -- payload
  p_last_payload_id       uuid,
  p_last_material_hash    text,
  p_observed_at           timestamptz,
  -- version
  p_connector_version     text,
  p_normalized_json       jsonb,
  -- task gating
  p_min_score_for_review  integer
)
returns table (
  -- posting fields
  posting_id              uuid,
  job_source_id           uuid,
  identity_key            text,
  canonical_url           text,
  current_status          text,
  first_seen_at           timestamptz,
  last_seen_at            timestamptz,
  last_material_hash      text,
  relevance_score         integer,
  relevance_score_version smallint,
  -- observation outcome
  created                 boolean,
  material_changed        boolean,
  reopened                boolean,
  stale_observation       boolean,
  -- version outcome
  version_id              uuid,
  version_inserted        boolean,
  -- task outcome
  review_task_id          uuid,
  review_task_type        text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_posting        public.source_postings%rowtype;
  v_existing       public.source_postings%rowtype;
  v_run            public.source_fetch_runs%rowtype;
  v_created        boolean := false;
  v_mat_changed    boolean := false;
  v_reopened       boolean := false;
  v_stale          boolean := false;

  v_prior_ver_id   uuid;
  v_prior_norm_json jsonb;
  v_version_id     uuid;
  v_version_ins    boolean := false;
  v_field_diff     jsonb;

  v_task_type      text;
  v_task_notes     text;
  v_task_id        uuid;
begin
  -- Lock and validate the running fetch run.
  select * into v_run
  from public.source_fetch_runs
  where id = p_fetch_run_id
  for update;

  if v_run.id is null then
    raise exception 'persist_posting_observation: fetch run not found: %', p_fetch_run_id;
  end if;
  if v_run.job_source_id <> p_job_source_id then
    raise exception 'persist_posting_observation: fetch run source mismatch';
  end if;
  if v_run.status <> 'running' then
    raise exception 'persist_posting_observation: fetch run % is not running (status=%)', p_fetch_run_id, v_run.status;
  end if;

  -- Serialize by (job_source_id, identity_key) to prevent concurrent races.
  perform pg_advisory_xact_lock(
    hashtext(p_job_source_id::text || ':' || p_identity_key)
  );

  select * into v_existing
  from public.source_postings as sp
  where sp.job_source_id = p_job_source_id
    and sp.identity_key   = p_identity_key
  for update;

  -- ── Create or update posting ────────────────────────────────────────────────
  if v_existing.id is null then
    v_created     := true;
    v_mat_changed := true;

    insert into public.source_postings (
      job_source_id, identity_key, canonical_url, external_posting_id,
      employer_name_raw, employer_name_normalized,
      title_raw, title_normalized,
      location_raw, location_normalized,
      remote_type, employment_type, classification, department, focus_area,
      posted_at, closes_at, deadline_kind,
      current_status, relevance_score, relevance_score_version,
      score_breakdown_json, uncertainty_flags,
      first_seen_at, last_seen_at,
      last_payload_id, last_material_hash, consecutive_misses
    ) values (
      p_job_source_id, p_identity_key, p_canonical_url, p_external_posting_id,
      p_employer_name_raw, p_employer_name_normalized,
      p_title_raw, p_title_normalized,
      p_location_raw, p_location_normalized,
      p_remote_type, p_employment_type, p_classification, p_department, p_focus_area,
      p_posted_at, p_closes_at, p_deadline_kind,
      p_current_status, p_relevance_score, p_relevance_score_version,
      coalesce(p_score_breakdown_json, '{}'::jsonb),
      coalesce(p_uncertainty_flags, '{}'::text[]),
      p_observed_at, p_observed_at,
      p_last_payload_id, p_last_material_hash, 0
    )
    returning * into v_posting;

  else
    -- Reject stale observations.
    if p_observed_at < v_existing.last_seen_at then
      v_stale       := true;
      v_posting     := v_existing;
      v_mat_changed := false;
      v_reopened    := false;
    else
      v_mat_changed := v_existing.last_material_hash is distinct from p_last_material_hash;
      v_reopened    := v_existing.current_status in ('closed', 'missing', 'closure_candidate')
                       and p_current_status in ('open', 'reopened');

      update public.source_postings
      set
        canonical_url             = p_canonical_url,
        external_posting_id       = p_external_posting_id,
        employer_name_raw         = p_employer_name_raw,
        employer_name_normalized  = p_employer_name_normalized,
        title_raw                 = p_title_raw,
        title_normalized          = p_title_normalized,
        location_raw              = p_location_raw,
        location_normalized       = p_location_normalized,
        remote_type               = p_remote_type,
        employment_type           = p_employment_type,
        classification            = p_classification,
        department                = p_department,
        focus_area                = p_focus_area,
        posted_at                 = p_posted_at,
        closes_at                 = p_closes_at,
        deadline_kind             = p_deadline_kind,
        -- Automatically promote 'open' to 'reopened' when a previously-closed
        -- posting is observed again, so callers can always pass 'open'.
        current_status            = case
          when v_existing.current_status in ('closed', 'missing', 'closure_candidate')
               and p_current_status = 'open'
            then 'reopened'
          else p_current_status
        end,
        relevance_score           = p_relevance_score,
        relevance_score_version   = p_relevance_score_version,
        score_breakdown_json      = coalesce(p_score_breakdown_json, '{}'::jsonb),
        uncertainty_flags         = coalesce(p_uncertainty_flags, '{}'::text[]),
        last_seen_at              = p_observed_at,
        last_payload_id           = p_last_payload_id,
        last_material_hash        = case when p_observed_at >= v_existing.last_seen_at
                                         then p_last_material_hash
                                         else v_existing.last_material_hash end,
        consecutive_misses        = 0
      where id = v_existing.id
      returning * into v_posting;
    end if;
  end if;

  -- ── Inspect prior version + insert new version ──────────────────────────────
  if not v_stale and (v_created or v_mat_changed) then
    -- Get the immediately preceding version for diff computation.
    select id, normalized_json
    into v_prior_ver_id, v_prior_norm_json
    from public.source_posting_versions
    where source_posting_id = v_posting.id
    order by created_at desc
    limit 1;

    v_field_diff := case
      when v_prior_ver_id is not null
        then public._jsonb_field_diff(v_prior_norm_json, p_normalized_json)
      else '{}'::jsonb
    end;

    insert into public.source_posting_versions (
      source_posting_id, source_fetch_run_id, source_payload_id,
      connector_version, is_material_change, material_hash,
      normalized_json, score_breakdown_json, field_diff_json
    ) values (
      v_posting.id, p_fetch_run_id, p_last_payload_id,
      p_connector_version, not v_created, p_last_material_hash,
      p_normalized_json, coalesce(p_score_breakdown_json, '{}'::jsonb), v_field_diff
    )
    on conflict (source_posting_id, source_fetch_run_id) do nothing
    returning id into v_version_id;

    v_version_ins := v_version_id is not null;

    -- If a prior insert won the race (idempotent replay), fetch its id.
    if not v_version_ins then
      select id into v_version_id
      from public.source_posting_versions
      where source_posting_id = v_posting.id
        and source_fetch_run_id = p_fetch_run_id;
    end if;
  end if;

  -- ── Create review task (idempotent via partial unique index) ────────────────
  if not v_stale then
    if v_created and p_relevance_score >= p_min_score_for_review then
      v_task_type  := 'source_new';
      v_task_notes := format(
        '[source_new:%s] New relevant source posting observed (%s).',
        p_last_material_hash, p_identity_key
      );
    elsif v_reopened then
      v_task_type  := 'source_reopened';
      v_task_notes := format(
        '[source_reopened:%s] Previously closed posting was observed open again (%s).',
        p_last_material_hash, p_identity_key
      );
    elsif v_mat_changed and not v_created then
      v_task_type  := 'source_changed';
      v_task_notes := format(
        '[source_changed:%s] Material change detected for source posting %s.',
        p_last_material_hash, p_identity_key
      );
    end if;

    if v_task_type is not null then
      insert into public.review_tasks (task_type, entity_table, entity_id, status, notes)
      values (v_task_type, 'source_postings', v_posting.id, 'open', v_task_notes)
      on conflict (task_type, entity_table, entity_id, notes)
      where status = 'open'
      do nothing
      returning id into v_task_id;
    end if;
  end if;

  -- ── Return row ───────────────────────────────────────────────────────────────
  posting_id              := v_posting.id;
  job_source_id           := v_posting.job_source_id;
  identity_key            := v_posting.identity_key;
  canonical_url           := v_posting.canonical_url;
  current_status          := v_posting.current_status;
  first_seen_at           := v_posting.first_seen_at;
  last_seen_at            := v_posting.last_seen_at;
  last_material_hash      := v_posting.last_material_hash;
  relevance_score         := v_posting.relevance_score;
  relevance_score_version := v_posting.relevance_score_version;
  created                 := v_created;
  material_changed        := v_mat_changed;
  reopened                := v_reopened;
  stale_observation       := v_stale;
  version_id              := v_version_id;
  version_inserted        := v_version_ins;
  review_task_id          := v_task_id;
  review_task_type        := v_task_type;

  return next;
end;
$$;

-- ─── 4. Concurrency-safe pending opportunity creation ────────────────────────

create or replace function public.create_pending_opportunity(
  p_company_id         uuid,
  p_source_record_id   uuid,
  p_title              text,
  p_posting_url        text,
  p_location           text,
  p_focus_area         text,
  p_deadline           date,
  p_deadline_text      text,
  p_paid_status        text,
  p_application_type   text,
  p_source_status_raw  text,
  p_relevance_score    integer,
  p_relevance_reasons  text[],
  p_dedupe_key         text,
  p_family_key         text,
  p_observed_at        timestamptz
)
returns table (
  opportunity_id  uuid,
  opp_created     boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opp     public.opportunities%rowtype;
  v_created boolean := false;
begin
  -- Advisory lock serializes concurrent inserts for the same dedupe key.
  perform pg_advisory_xact_lock(hashtext(p_dedupe_key));

  -- Recheck under the lock.
  select * into v_opp
  from public.opportunities
  where dedupe_key = p_dedupe_key
  limit 1;

  if v_opp.id is null then
    insert into public.opportunities (
      company_id, source_record_id, title, posting_url,
      location, focus_area, deadline, deadline_text,
      paid_status, application_type, source_status_raw,
      status, review_status, public_safe,
      relevance_score, relevance_reasons,
      dedupe_key, family_key,
      first_seen_at, last_seen_at
    ) values (
      p_company_id, p_source_record_id, p_title, p_posting_url,
      p_location, p_focus_area, p_deadline, p_deadline_text,
      p_paid_status, p_application_type, p_source_status_raw,
      'needs_review', 'pending', false,
      p_relevance_score, coalesce(p_relevance_reasons, '{}'),
      p_dedupe_key, p_family_key,
      p_observed_at, p_observed_at
    )
    returning * into v_opp;
    v_created := true;
  end if;

  opportunity_id := v_opp.id;
  opp_created    := v_created;
  return next;
end;
$$;

-- ─── 5. Permissions ──────────────────────────────────────────────────────────

-- Revoke the old posting-only RPC from all roles.
revoke execute on function public.upsert_source_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, date, date, text, text, integer, smallint, jsonb, text[], uuid, text, timestamptz
) from public;

revoke execute on function public.upsert_source_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, date, date, text, text, integer, smallint, jsonb, text[], uuid, text, timestamptz
) from anon;

revoke execute on function public.upsert_source_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text,
  text, text, text, date, date, text, text, integer, smallint, jsonb, text[], uuid, text, timestamptz
) from authenticated;

-- Deny the new RPCs from unprivileged roles (PostgreSQL grants execute to PUBLIC
-- by default for newly created functions).
revoke execute on function public._jsonb_field_diff(jsonb, jsonb) from public;
revoke execute on function public._jsonb_field_diff(jsonb, jsonb) from anon;
revoke execute on function public._jsonb_field_diff(jsonb, jsonb) from authenticated;

revoke execute on function public.persist_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, date, date, text, text,
  integer, smallint, jsonb, text[], uuid, text, timestamptz,
  text, jsonb, integer
) from public;

revoke execute on function public.persist_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, date, date, text, text,
  integer, smallint, jsonb, text[], uuid, text, timestamptz,
  text, jsonb, integer
) from anon;

revoke execute on function public.persist_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, date, date, text, text,
  integer, smallint, jsonb, text[], uuid, text, timestamptz,
  text, jsonb, integer
) from authenticated;

revoke execute on function public.create_pending_opportunity(
  uuid, uuid, text, text, text, text, date, text, text, text, text,
  integer, text[], text, text, timestamptz
) from public;

revoke execute on function public.create_pending_opportunity(
  uuid, uuid, text, text, text, text, date, text, text, text, text,
  integer, text[], text, text, timestamptz
) from anon;

revoke execute on function public.create_pending_opportunity(
  uuid, uuid, text, text, text, text, date, text, text, text, text,
  integer, text[], text, text, timestamptz
) from authenticated;

-- Grant the new RPCs only to service_role.
grant execute on function public.persist_posting_observation(
  uuid, uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, date, date, text, text,
  integer, smallint, jsonb, text[], uuid, text, timestamptz,
  text, jsonb, integer
) to service_role;

grant execute on function public.create_pending_opportunity(
  uuid, uuid, text, text, text, text, date, text, text, text, text,
  integer, text[], text, text, timestamptz
) to service_role;
