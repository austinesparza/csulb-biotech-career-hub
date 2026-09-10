-- Private, lossless archive for recurring web and LinkedIn discovery.
-- Leads and observations are never public and never approve opportunities.

create table if not exists public.discovery_leads (
  id                         uuid primary key default gen_random_uuid(),
  lead_key                   text not null unique check (length(lead_key) = 64),
  route                      text not null check (route in (
                               'official_feed', 'employer_page', 'web_search', 'linkedin_lead'
                             )),
  original_url               text not null check (trim(original_url) <> ''),
  normalized_url             text,
  canonical_employer_url     text,
  resolution                 text not null check (resolution in (
                               'official_source_found', 'linkedin_only', 'aggregator_only',
                               'dead_link', 'unresolved'
                             )),
  archive_reason             text not null check (trim(archive_reason) <> ''),
  lane                       text,
  latest_title               text,
  latest_snippet             text,
  employer_hint              text,
  original_reachable         boolean not null,
  officer_status             text not null default 'new'
                               check (officer_status in ('new', 'in_review', 'resolved', 'archived')),
  first_seen_at              timestamptz not null,
  last_seen_at               timestamptz not null,
  occurrence_count           integer not null default 1 check (occurrence_count > 0),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  check (first_seen_at <= last_seen_at)
);

create table if not exists public.discovery_lead_observations (
  id                         uuid primary key default gen_random_uuid(),
  lead_id                    uuid not null references public.discovery_leads(id) on delete restrict,
  observation_key            text not null unique check (length(observation_key) = 64),
  run_id                     text not null check (trim(run_id) <> ''),
  query                      text,
  retrieved_at               timestamptz not null,
  visible_title              text,
  visible_snippet            text,
  raw_metadata               jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(raw_metadata) = 'object'),
  created_at                 timestamptz not null default now()
);

create index if not exists idx_discovery_leads_officer_queue
  on public.discovery_leads(officer_status, last_seen_at desc);
create index if not exists idx_discovery_lead_observations_lead
  on public.discovery_lead_observations(lead_id, retrieved_at desc);

alter table public.discovery_leads enable row level security;
alter table public.discovery_lead_observations enable row level security;

revoke all on public.discovery_leads from public, anon, authenticated, service_role;
revoke all on public.discovery_lead_observations from public, anon, authenticated, service_role;
grant select on public.discovery_leads, public.discovery_lead_observations to authenticated;
grant select, insert, update on public.discovery_leads to service_role;
grant select, insert on public.discovery_lead_observations to service_role;

create policy officer_select_discovery_leads
  on public.discovery_leads for select to authenticated
  using (public.is_officer());
create policy officer_select_discovery_lead_observations
  on public.discovery_lead_observations for select to authenticated
  using (public.is_officer());

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
      resolution = p_resolution,
      archive_reason = p_archive_reason,
      lane = coalesce(p_lane, lane),
      latest_title = coalesce(p_visible_title, latest_title),
      latest_snippet = coalesce(p_visible_snippet, latest_snippet),
      employer_hint = coalesce(p_employer_hint, employer_hint),
      original_reachable = p_original_reachable,
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

  if v_created then
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

revoke execute on function public.archive_discovery_lead(
  text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.archive_discovery_lead(
  text, text, text, text, text, text, text, text, text, text, text,
  boolean, text, text, text, jsonb, timestamptz
) to service_role;

comment on table public.discovery_leads is
  'Private lead identities and resolution state. No row grants publication authority.';
comment on table public.discovery_lead_observations is
  'Immutable per-run discovery observations retained for audit and recall measurement.';
