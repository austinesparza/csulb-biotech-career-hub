-- Search-index observations are archived without flooding the officer task queue.
-- Only an explicitly triaged unique source-research candidate requests attention.
-- A later search observation cannot downgrade an employer URL already checked by an officer.

create or replace function public.archive_discovery_lead(
  p_lead_key text,
  p_observation_key text,
  p_run_id text,
  p_route text,
  p_query text,
  p_lane text,
  p_original_url text,
  p_normalized_url text,
  p_visible_title text,
  p_visible_snippet text,
  p_employer_hint text,
  p_original_reachable boolean,
  p_canonical_employer_url text,
  p_resolution text,
  p_archive_reason text,
  p_raw_metadata jsonb,
  p_retrieved_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_lead_id uuid;
  v_created boolean := false;
  v_rows integer := 0;
begin
  if length(p_lead_key) <> 64 or length(p_observation_key) <> 64 then
    raise exception 'discovery keys must be SHA-256 hex strings';
  end if;
  if trim(coalesce(p_run_id, '')) = '' or trim(coalesce(p_original_url, '')) = '' then
    raise exception 'run ID and original URL are required';
  end if;
  if length(p_run_id) > 160 or length(p_original_url) > 2000
     or length(coalesce(p_normalized_url, '')) > 2000
     or length(coalesce(p_canonical_employer_url, '')) > 2000
     or length(coalesce(p_query, '')) > 2000
     or length(coalesce(p_visible_title, '')) > 500
     or length(coalesce(p_visible_snippet, '')) > 5000
     or length(coalesce(p_employer_hint, '')) > 500
     or length(coalesce(p_archive_reason, '')) > 1000 then
    raise exception 'discovery lead field exceeds its limit';
  end if;
  if p_route not in ('official_feed', 'employer_page', 'web_search', 'linkedin_lead') then
    raise exception 'invalid discovery route';
  end if;
  if p_resolution not in (
    'official_source_found', 'linkedin_only', 'aggregator_only', 'dead_link', 'unresolved'
  ) then
    raise exception 'invalid lead resolution';
  end if;
  if trim(coalesce(p_archive_reason, '')) = '' then
    raise exception 'archive reason is required';
  end if;
  if jsonb_typeof(coalesce(p_raw_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'raw metadata must be an object';
  end if;

  insert into public.discovery_leads (
    lead_key, route, original_url, normalized_url, canonical_employer_url,
    resolution, archive_reason, lane, latest_title, latest_snippet,
    employer_hint, original_reachable, first_seen_at, last_seen_at
  ) values (
    p_lead_key, p_route, p_original_url, p_normalized_url, p_canonical_employer_url,
    p_resolution, p_archive_reason, p_lane, p_visible_title, p_visible_snippet,
    p_employer_hint, p_original_reachable, p_retrieved_at, p_retrieved_at
  )
  on conflict (lead_key) do nothing
  returning id into v_lead_id;

  v_created := v_lead_id is not null;
  if not v_created then
    update public.discovery_leads set
      route = p_route,
      normalized_url = coalesce(p_normalized_url, normalized_url),
      canonical_employer_url = coalesce(p_canonical_employer_url, canonical_employer_url),
      resolution = case when resolution = 'official_source_found' and p_resolution = 'unresolved'
        then resolution else p_resolution end,
      archive_reason = case when resolution = 'official_source_found' and p_resolution = 'unresolved'
        then archive_reason else p_archive_reason end,
      lane = coalesce(p_lane, lane),
      latest_title = coalesce(p_visible_title, latest_title),
      latest_snippet = coalesce(p_visible_snippet, latest_snippet),
      employer_hint = coalesce(p_employer_hint, employer_hint),
      original_reachable = original_reachable or p_original_reachable,
      last_seen_at = greatest(last_seen_at, p_retrieved_at),
      updated_at = now()
    where lead_key = p_lead_key
    returning id into v_lead_id;
  end if;

  insert into public.discovery_lead_observations (
    lead_id, observation_key, run_id, query, retrieved_at,
    visible_title, visible_snippet, raw_metadata
  ) values (
    v_lead_id, p_observation_key, p_run_id, p_query, p_retrieved_at,
    p_visible_title, p_visible_snippet, coalesce(p_raw_metadata, '{}'::jsonb)
  )
  on conflict (observation_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 and not v_created then
    update public.discovery_leads
    set occurrence_count = occurrence_count + 1
    where id = v_lead_id;
  end if;

  if v_created and p_raw_metadata->>'reviewCandidate' = 'true' then
    insert into public.review_tasks(task_type, entity_table, entity_id, status, priority, notes)
    values (
      'source_new', 'discovery_leads', v_lead_id, 'open', 100,
      concat(
        'Discovery lead: ', coalesce(nullif(trim(p_visible_title), ''), 'Untitled lead'),
        E'\n', p_original_url
      )
    )
    on conflict do nothing;
  end if;

  return v_lead_id;
end;
$$;

