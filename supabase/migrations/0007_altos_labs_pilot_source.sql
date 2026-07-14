-- Phase 2C: Altos Labs Greenhouse ingestion pilot source registration.
-- Idempotent: safe to run multiple times.
--
-- Creates exactly:
--   1. One Altos Labs company (resolved by name_normalized).
--   2. One source_records row (resolved by oldest exact name+source_type match).
--   3. One job_sources row (upserted by source_record_id).
--
-- Nothing is published. public_safe remains false throughout.

do $$
declare
  v_company_id      uuid;
  v_source_record_id uuid;
begin

  -- ─── 1. Resolve or create the Altos Labs company ──────────────────────────
  --
  -- Select by name_normalized (unique). Insert only if absent.
  -- Never set public_safe = true on an existing row.
  -- Never set public_safe = true on a new row.

  select id
  into v_company_id
  from public.companies
  where name_normalized = 'altos labs'
  limit 1;

  if v_company_id is null then
    insert into public.companies (
      name,
      name_normalized,
      website,
      public_safe
    ) values (
      'Altos Labs',
      'altos labs',
      'https://www.altoslabs.com',
      false
    )
    returning id into v_company_id;
  else
    -- Update website if not already set, but never touch public_safe.
    update public.companies
    set website = coalesce(website, 'https://www.altoslabs.com')
    where id = v_company_id;
  end if;

  -- ─── 2. Resolve or create the source_records row ──────────────────────────
  --
  -- source_records.name is not unique. Select the oldest exact matching row
  -- (name = 'Altos Labs Greenhouse Job Board' AND source_type = 'website_page')
  -- before inserting a new one.

  select id
  into v_source_record_id
  from public.source_records
  where name        = 'Altos Labs Greenhouse Job Board'
    and source_type = 'website_page'
  order by created_at asc
  limit 1;

  if v_source_record_id is null then
    insert into public.source_records (
      name,
      source_type,
      url,
      access_level,
      canonical_status,
      refresh_policy,
      public_safe
    ) values (
      'Altos Labs Greenhouse Job Board',
      'website_page',
      'https://job-boards.greenhouse.io/altoslabs',
      'officers',
      'pilot automated source',
      'Manual officer-triggered Greenhouse API fetch only. No scheduler and no automatic publication.',
      false
    )
    returning id into v_source_record_id;
  end if;

  -- ─── 3. Upsert the job_sources row ────────────────────────────────────────
  --
  -- Conflict target is source_record_id (unique column on job_sources).
  -- On conflict: update all mutable fields except source_record_id itself.

  insert into public.job_sources (
    source_record_id,
    company_id,
    source_name,
    source_kind,
    source_identifier,
    careers_url,
    api_endpoint,
    config_json,
    enabled,
    priority,
    fetch_interval_hours,
    terms_reviewed,
    terms_review_date,
    robots_reviewed,
    automatic_scheduling_paused_at,
    notes
  ) values (
    v_source_record_id,
    v_company_id,
    'Altos Labs Greenhouse',
    'greenhouse',
    'altoslabs',
    'https://job-boards.greenhouse.io/altoslabs',
    'https://boards-api.greenhouse.io/v1/boards/altoslabs/jobs?content=true',
    '{"boardToken":"altoslabs","employerName":"Altos Labs","mode":"manual_pilot"}'::jsonb,
    true,
    10,
    24,
    true,
    '2026-07-14'::date,
    true,
    null,
    'Documented Greenhouse Job Board API public GET endpoint. No application submission, authenticated endpoint, or HTML crawler is used. Manual pilot only.'
  )
  on conflict (source_record_id) do update
    set
      company_id                      = excluded.company_id,
      source_name                     = excluded.source_name,
      source_kind                     = excluded.source_kind,
      source_identifier               = excluded.source_identifier,
      careers_url                     = excluded.careers_url,
      api_endpoint                    = excluded.api_endpoint,
      config_json                     = excluded.config_json,
      enabled                         = excluded.enabled,
      priority                        = excluded.priority,
      fetch_interval_hours            = excluded.fetch_interval_hours,
      terms_reviewed                  = excluded.terms_reviewed,
      terms_review_date               = excluded.terms_review_date,
      robots_reviewed                 = excluded.robots_reviewed,
      automatic_scheduling_paused_at  = excluded.automatic_scheduling_paused_at,
      notes                           = excluded.notes,
      updated_at                      = now();

end;
$$;
