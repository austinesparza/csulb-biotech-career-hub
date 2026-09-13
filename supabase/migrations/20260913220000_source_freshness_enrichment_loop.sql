-- Keep automated-source observations useful after officer approval without allowing
-- the machine layer to rewrite curated public content. Also detect postings that
-- disappear from complete source inventories and enrich nonpublic drafts from
-- authoritative source text.

create or replace function public.infer_source_paid_status(p_text text)
returns public.paid_status
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_text text := coalesce(p_text, '');
begin
  if v_text = '' then
    return 'unknown'::public.paid_status;
  end if;

  if v_text ~* '\m(unpaid)[ -]+(internship|co-op|position|role|opportunity)\M'
     or v_text ~* '\m(internship|co-op|position|role|opportunity)\M[^.!?]{0,50}\mis unpaid\M' then
    return 'unpaid'::public.paid_status;
  end if;

  if v_text ~* '\m(?:base[[:space:]]+)?(?:pay|salary|compensation|wage)\M[^.!?]{0,80}\$[[:space:]]*[0-9]'
     or v_text ~* '\$[[:space:]]*[0-9][0-9,]*(?:\.[0-9]+)?[[:space:]]*(?:/|per[[:space:]]+)\s*(?:hour|hr|month|year)\M'
     or v_text ~* '\mpaid[ -]+(internship|co-op|position|role|opportunity)\M' then
    return 'paid'::public.paid_status;
  end if;

  if v_text ~* '\mstipend(?:ed)?\M' then
    return 'stipend'::public.paid_status;
  end if;

  return 'unknown'::public.paid_status;
end;
$$;

create or replace function public.extract_source_compensation_note(p_text text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_sentence text;
  v_clean text;
  v_status public.paid_status;
begin
  v_status := public.infer_source_paid_status(p_text);
  if v_status = 'unknown' then
    return null;
  end if;

  for v_sentence in
    select value
    from regexp_split_to_table(coalesce(p_text, ''), '[.!?][[:space:]]+|[[:space:]]*[•▪◦][[:space:]]*') as value
  loop
    v_clean := btrim(regexp_replace(v_sentence, '[[:space:]]+', ' ', 'g'));
    if v_clean = '' then
      continue;
    end if;

    if (v_status = 'unpaid' and (
          v_clean ~* '\m(unpaid)[ -]+(internship|co-op|position|role|opportunity)\M'
          or v_clean ~* '\m(internship|co-op|position|role|opportunity)\M[^.!?]{0,50}\mis unpaid\M'
       ))
       or (v_status = 'stipend' and v_clean ~* '\mstipend(?:ed)?\M')
       or (v_status = 'paid' and (
          v_clean ~* '\m(?:base[[:space:]]+)?(?:pay|salary|compensation|wage)\M[^.!?]{0,80}\$[[:space:]]*[0-9]'
          or v_clean ~* '\$[[:space:]]*[0-9][0-9,]*(?:\.[0-9]+)?[[:space:]]*(?:/|per[[:space:]]+)\s*(?:hour|hr|month|year)\M'
          or v_clean ~* '\mpaid[ -]+(internship|co-op|position|role|opportunity)\M'
       )) then
      return left(v_clean, 360);
    end if;
  end loop;

  return case
    when v_status = 'unpaid' then 'Employer posting states that this opportunity is unpaid.'
    when v_status = 'stipend' then 'Employer posting states that a stipend is provided.'
    else null
  end;
end;
$$;

create or replace function public.extract_source_program_timing(p_title text, p_text text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_combined text := concat_ws(' ', p_title, p_text);
  v_range text[];
  v_term text[];
  v_duration text[];
  v_term_label text;
begin
  -- Preserve an explicit source date range without inventing an unstated start year.
  v_range := regexp_match(
    coalesce(p_text, ''),
    '((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[[:space:]]+[0-9]{1,2}(?:st|nd|rd|th)?(?:,[[:space:]]*20[0-9]{2})?[[:space:]]+(?:through|to|until|[-–])[[:space:]]+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[[:space:]]+[0-9]{1,2}(?:st|nd|rd|th)?(?:,[[:space:]]*20[0-9]{2}))',
    'i'
  );
  if v_range is not null then
    return btrim(regexp_replace(v_range[1], '[[:space:]]+', ' ', 'g'));
  end if;

  v_term := regexp_match(
    v_combined,
    '\m(Spring|Summer|Fall|Autumn|Winter)\M[[:space:]]+(20[0-9]{2})',
    'i'
  );
  if v_term is null then
    v_term := regexp_match(
      v_combined,
      '\m(20[0-9]{2})\M[[:space:]]+(Spring|Summer|Fall|Autumn|Winter)\M',
      'i'
    );
    if v_term is not null then
      v_term_label := initcap(lower(v_term[2])) || ' ' || v_term[1];
    end if;
  else
    v_term_label := initcap(lower(v_term[1])) || ' ' || v_term[2];
  end if;

  if v_term_label is null then
    return null;
  end if;

  v_duration := regexp_match(
    coalesce(p_text, ''),
    '\m((?:approximately|about)[[:space:]]+)?([0-9]{1,2})[ -]?(week|month)s?\M',
    'i'
  );
  if v_duration is not null then
    return v_term_label || ' ('
      || case when v_duration[1] is not null then lower(btrim(v_duration[1])) else '' end
      || v_duration[2] || ' ' || lower(v_duration[3])
      || case when v_duration[2] = '1' then '' else 's' end || ')';
  end if;

  return v_term_label;
end;
$$;

-- A new successful observation clears any prior missing-state counters. This runs
-- before the existing updated_at trigger and before downstream observation sync.
create or replace function public.reset_source_posting_miss_state_on_observation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.last_seen_at > old.last_seen_at
     and new.current_status in ('open', 'reopened') then
    new.consecutive_misses := 0;
    new.closure_confidence := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_source_postings_reset_miss_state on public.source_postings;
create trigger trg_source_postings_reset_miss_state
  before update of last_seen_at, current_status on public.source_postings
  for each row execute function public.reset_source_posting_miss_state_on_observation();

-- Synchronize observation metadata only. This intentionally does not change
-- curated title, eligibility, notes, pay, dates, audience, or publication state.
create or replace function public.sync_primary_opportunity_source_observation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.opportunities o
  set last_checked_at = case
        when o.last_checked_at is null or o.last_checked_at < new.last_seen_at then new.last_seen_at
        else o.last_checked_at
      end,
      source_status_raw = new.current_status,
      source_check_result = case
        when new.current_status in ('open', 'reopened') then 'open'::public.source_check_result
        when new.current_status in ('missing', 'closure_candidate', 'closed') then 'missing'::public.source_check_result
        else o.source_check_result
      end
  from public.opportunity_source_links osl
  where osl.source_posting_id = new.id
    and osl.is_primary
    and osl.opportunity_id = o.id;

  return new;
end;
$$;

drop trigger if exists trg_source_postings_sync_primary_opportunity on public.source_postings;
create trigger trg_source_postings_sync_primary_opportunity
  after update of last_seen_at, current_status on public.source_postings
  for each row execute function public.sync_primary_opportunity_source_observation();

-- Link insertion happens after the immutable source version exists in the normal
-- ingestion path. Initialize source-check metadata and fill only missing fields on
-- nonpublic, still-reviewable drafts.
create or replace function public.enrich_opportunity_from_primary_source_link()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sp public.source_postings%rowtype;
  v_snapshot jsonb;
  v_description text;
  v_title text;
  v_paid public.paid_status;
  v_note text;
  v_timing text;
begin
  if not new.is_primary then
    return new;
  end if;

  select * into v_sp
  from public.source_postings
  where id = new.source_posting_id;

  if not found then
    return new;
  end if;

  update public.opportunities o
  set last_checked_at = case
        when o.last_checked_at is null or o.last_checked_at < v_sp.last_seen_at then v_sp.last_seen_at
        else o.last_checked_at
      end,
      source_status_raw = v_sp.current_status,
      source_check_result = case
        when v_sp.current_status in ('open', 'reopened') then 'open'::public.source_check_result
        when v_sp.current_status in ('missing', 'closure_candidate', 'closed') then 'missing'::public.source_check_result
        else o.source_check_result
      end
  where o.id = new.opportunity_id;

  select spv.normalized_json into v_snapshot
  from public.source_posting_versions spv
  where spv.source_posting_id = new.source_posting_id
  order by spv.created_at desc, spv.id desc
  limit 1;

  if v_snapshot is null then
    return new;
  end if;

  v_description := nullif(v_snapshot ->> 'descriptionText', '');
  v_title := coalesce(nullif(v_snapshot ->> 'titleRaw', ''), v_sp.title_raw);
  v_paid := public.infer_source_paid_status(v_description);
  v_note := public.extract_source_compensation_note(v_description);
  v_timing := public.extract_source_program_timing(v_title, v_description);

  update public.opportunities o
  set paid_status = case
        when o.paid_status = 'unknown' and v_paid <> 'unknown' then v_paid
        else o.paid_status
      end,
      public_notes = coalesce(o.public_notes, v_note),
      start_date_text = coalesce(o.start_date_text, v_timing),
      discovery_route = 'official_feed'::public.discovery_route
  where o.id = new.opportunity_id
    and not o.public_safe
    and o.review_status not in ('approved', 'rejected')
    and o.status not in ('closed', 'expired', 'broken_link', 'hidden', 'duplicate', 'not_relevant', 'archive_only');

  return new;
end;
$$;

drop trigger if exists trg_opportunity_source_links_enrich_primary on public.opportunity_source_links;
create trigger trg_opportunity_source_links_enrich_primary
  after insert on public.opportunity_source_links
  for each row execute function public.enrich_opportunity_from_primary_source_link();

-- Material source versions are private evidence. They may enrich a pending draft,
-- but an approved record is only marked changed so an officer can decide whether
-- curated public content should be updated.
create or replace function public.sync_opportunity_from_source_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_description text;
  v_title text;
  v_paid public.paid_status;
  v_note text;
  v_timing text;
begin
  v_description := nullif(new.normalized_json ->> 'descriptionText', '');
  v_title := nullif(new.normalized_json ->> 'titleRaw', '');
  v_paid := public.infer_source_paid_status(v_description);
  v_note := public.extract_source_compensation_note(v_description);
  v_timing := public.extract_source_program_timing(v_title, v_description);

  update public.opportunities o
  set paid_status = case
        when o.paid_status = 'unknown' and v_paid <> 'unknown' then v_paid
        else o.paid_status
      end,
      public_notes = coalesce(o.public_notes, v_note),
      start_date_text = coalesce(o.start_date_text, v_timing),
      discovery_route = 'official_feed'::public.discovery_route
  from public.opportunity_source_links osl
  where osl.source_posting_id = new.source_posting_id
    and osl.is_primary
    and osl.opportunity_id = o.id
    and not o.public_safe
    and o.review_status not in ('approved', 'rejected')
    and o.status not in ('closed', 'expired', 'broken_link', 'hidden', 'duplicate', 'not_relevant', 'archive_only');

  if new.is_material_change then
    update public.opportunities o
    set source_check_result = 'changed'::public.source_check_result
    from public.opportunity_source_links osl
    where osl.source_posting_id = new.source_posting_id
      and osl.is_primary
      and osl.opportunity_id = o.id
      and o.review_status = 'approved'
      and o.public_safe;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_source_posting_versions_sync_opportunity on public.source_posting_versions;
create trigger trg_source_posting_versions_sync_opportunity
  after insert on public.source_posting_versions
  for each row execute function public.sync_opportunity_from_source_version();

-- A completed source run is an inventory assertion. If a previously observed
-- posting is absent from a complete, successful inventory, accumulate evidence
-- rather than auto-closing or unpublishing the curated opportunity.
create or replace function public.mark_missing_source_postings_after_complete_run()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_affected integer := 0;
begin
  if old.status is not distinct from new.status
     or new.status <> 'completed'
     or old.status <> 'running'
     or new.started_at is null
     or coalesce(new.payload_count, 0) < 1
     or coalesce(new.http_status, 0) < 200
     or coalesce(new.http_status, 0) >= 300
     or lower(coalesce(new.log_json ->> 'privateTest', 'false')) = 'true' then
    return new;
  end if;

  update public.source_postings sp
  set consecutive_misses = sp.consecutive_misses + 1,
      current_status = case
        when sp.consecutive_misses + 1 >= 2 then 'missing'
        else 'closure_candidate'
      end,
      closure_confidence = least(
        0.95::numeric,
        case
          when sp.consecutive_misses + 1 = 1 then 0.50::numeric
          when sp.consecutive_misses + 1 = 2 then 0.85::numeric
          else 0.90::numeric + least((sp.consecutive_misses - 1) * 0.01::numeric, 0.05::numeric)
        end
      )
  where sp.job_source_id = new.job_source_id
    and sp.last_seen_at < new.started_at
    and sp.current_status in ('open', 'reopened', 'closure_candidate', 'missing');
  get diagnostics v_affected = row_count;

  if v_affected > 0 then
    insert into public.review_tasks(
      task_type, entity_table, entity_id, status, priority, due_date, notes
    )
    select
      'stale_record',
      'opportunities',
      o.id,
      'open',
      80,
      current_date,
      'Primary automated source did not contain this opportunity in a completed fetch. Verify the employer posting before changing publication status.'
    from public.source_postings sp
    join public.opportunity_source_links osl
      on osl.source_posting_id = sp.id and osl.is_primary
    join public.opportunities o on o.id = osl.opportunity_id
    where sp.job_source_id = new.job_source_id
      and sp.last_seen_at < new.started_at
      and sp.consecutive_misses > 0
      and o.review_status = 'approved'
      and o.public_safe
    on conflict do nothing;
  end if;

  -- Preserve final run status while surfacing the number of absent records.
  update public.source_fetch_runs
  set records_closed_candidates = v_affected
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_source_fetch_runs_mark_missing_postings on public.source_fetch_runs;
create trigger trg_source_fetch_runs_mark_missing_postings
  after update of status on public.source_fetch_runs
  for each row execute function public.mark_missing_source_postings_after_complete_run();

-- Bring existing primary links onto the observational contract without replacing
-- any officer-curated fields. Manual checks that are newer than the source fetch
-- retain their later timestamp.
update public.opportunities o
set last_checked_at = case
      when o.last_checked_at is null or o.last_checked_at < sp.last_seen_at then sp.last_seen_at
      else o.last_checked_at
    end,
    source_status_raw = sp.current_status,
    source_check_result = case
      when sp.current_status in ('open', 'reopened') then 'open'::public.source_check_result
      when sp.current_status in ('missing', 'closure_candidate', 'closed') then 'missing'::public.source_check_result
      else o.source_check_result
    end
from public.opportunity_source_links osl
join public.source_postings sp on sp.id = osl.source_posting_id
where osl.is_primary
  and osl.opportunity_id = o.id;

-- Existing reviewable drafts can benefit immediately from already archived source
-- evidence. Approved/rejected records are intentionally excluded.
with latest_version as (
  select distinct on (spv.source_posting_id)
    spv.source_posting_id,
    spv.normalized_json
  from public.source_posting_versions spv
  order by spv.source_posting_id, spv.created_at desc, spv.id desc
), enrichment as (
  select
    osl.opportunity_id,
    public.infer_source_paid_status(lv.normalized_json ->> 'descriptionText') as paid_status,
    public.extract_source_compensation_note(lv.normalized_json ->> 'descriptionText') as compensation_note,
    public.extract_source_program_timing(
      lv.normalized_json ->> 'titleRaw',
      lv.normalized_json ->> 'descriptionText'
    ) as program_timing
  from public.opportunity_source_links osl
  join latest_version lv on lv.source_posting_id = osl.source_posting_id
  where osl.is_primary
)
update public.opportunities o
set paid_status = case
      when o.paid_status = 'unknown' and e.paid_status <> 'unknown' then e.paid_status
      else o.paid_status
    end,
    public_notes = coalesce(o.public_notes, e.compensation_note),
    start_date_text = coalesce(o.start_date_text, e.program_timing),
    discovery_route = 'official_feed'::public.discovery_route
from enrichment e
where e.opportunity_id = o.id
  and not o.public_safe
  and o.review_status not in ('approved', 'rejected')
  and o.status not in ('closed', 'expired', 'broken_link', 'hidden', 'duplicate', 'not_relevant', 'archive_only');

revoke execute on function public.infer_source_paid_status(text) from public, anon, authenticated;
revoke execute on function public.extract_source_compensation_note(text) from public, anon, authenticated;
revoke execute on function public.extract_source_program_timing(text, text) from public, anon, authenticated;
revoke execute on function public.reset_source_posting_miss_state_on_observation() from public, anon, authenticated;
revoke execute on function public.sync_primary_opportunity_source_observation() from public, anon, authenticated;
revoke execute on function public.enrich_opportunity_from_primary_source_link() from public, anon, authenticated;
revoke execute on function public.sync_opportunity_from_source_version() from public, anon, authenticated;
revoke execute on function public.mark_missing_source_postings_after_complete_run() from public, anon, authenticated;

grant execute on function public.infer_source_paid_status(text) to service_role;
grant execute on function public.extract_source_compensation_note(text) to service_role;
grant execute on function public.extract_source_program_timing(text, text) to service_role;

grant execute on function public.reset_source_posting_miss_state_on_observation() to service_role;
grant execute on function public.sync_primary_opportunity_source_observation() to service_role;
grant execute on function public.enrich_opportunity_from_primary_source_link() to service_role;
grant execute on function public.sync_opportunity_from_source_version() to service_role;
grant execute on function public.mark_missing_source_postings_after_complete_run() to service_role;

comment on function public.mark_missing_source_postings_after_complete_run() is
  'Accumulates missing-posting evidence only after a complete successful inventory; never auto-unpublishes curated opportunities.';
comment on function public.sync_primary_opportunity_source_observation() is
  'Refreshes source-check metadata for primary-linked opportunities without altering curated public content.';