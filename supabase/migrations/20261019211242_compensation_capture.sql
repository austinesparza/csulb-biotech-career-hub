-- Preserve exact source compensation in the established public_notes contract.
-- Only private pending drafts are enriched; approved content still requires review.
create or replace function public.extract_source_compensation_note(p_text text)
returns text language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_part text;
  v_clean text;
  v_numeric text[] := array[]::text[];
  v_general text[] := array[]::text[];
begin
  for v_part in
    select value from regexp_split_to_table(coalesce(p_text, ''), '[.!?][[:space:]]+|[\n\r]+|[•▪◦]') as value
  loop
    v_clean := btrim(regexp_replace(v_part, '[[:space:]]+', ' ', 'g'));
    if v_clean = '' or v_clean ~* 'salary expectations?|desired salary|current salary|revenue|funding|capital raised|training cost|tuition cost|research budget|veteran.*compensation' then continue; end if;
    if v_clean ~* '\$[[:space:]]*[1-9][0-9,]*(\.[0-9]+)?'
       and (v_clean ~* '(base pay|base salary|salary range|pay range|pay rate|hourly pay|hourly range|hourly rate|hourly compensation|monthly compensation|expected pay|compensation range|employer compensation|paid a salary)'
         or v_clean ~* '(/|per[[:space:]]+)(hours?|hrs?|weeks?|months?|years?)\M|\m(hourly|weekly|monthly|annually|annualized|yearly|stipend)\M')
       and (v_clean !~* '\m(housing|relocation|travel|transportation|meal|signing|sign-on)\M'
         or v_clean ~* '(base pay|base salary|salary range|pay range|pay rate|hourly pay|hourly range|hourly rate|hourly compensation|monthly compensation|expected pay|compensation range)'
         or v_clean ~* '(/|per[[:space:]]+)(hours?|hrs?)\M') then
      if not v_clean = any(v_numeric) then v_numeric := array_append(v_numeric, v_clean); end if;
    elsif v_clean ~* '\mpaid[ -]+((summer|year[ -]round|full[ -]time|part[ -]time)[ -]+)*(internship|co[ -]?op|position|role|opportunity|program)\M'
       or v_clean ~* '\munpaid[ -]+(internship|co[ -]?op|position|role|opportunity)\M'
       or (v_clean ~* '\m(receive|receives|provided|provides|offer|offers|offered)\M[^.!?]{0,60}\mstipend\M'
         and v_clean !~* '\m(housing|relocation|travel|transportation|meal)\M') then
      if not v_clean = any(v_general) then v_general := array_append(v_general, v_clean); end if;
    end if;
  end loop;
  -- Prefer numeric terms even when generic "paid internship" occurs first.
  return nullif(array_to_string(case when cardinality(v_numeric) > 0 then v_numeric else v_general end, E'\n'), '');
end;
$$;

create or replace function public.infer_source_paid_status(p_text text)
returns public.paid_status language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $$
declare v_note text := public.extract_source_compensation_note(p_text);
begin
  if coalesce(p_text, '') ~* '\munpaid[ -]+(internship|co[ -]?op|position|role|opportunity)\M|\m(internship|co-op|position|role|opportunity)\M[^.!?]{0,50}\mis unpaid\M' then return 'unpaid'; end if;
  if v_note is null then return 'unknown'; end if;
  if v_note ~* '\mstipend\M' and v_note !~* '(base pay|salary|hourly pay|hourly rate|hourly range|paid internship|paid co-op|/hour|per hour)' then return 'stipend'; end if;
  return 'paid';
end;
$$;

create or replace function public.merge_source_compensation_note(p_notes text, p_compensation text)
returns text language sql immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when nullif(btrim(p_compensation), '') is null then p_notes
    when nullif(btrim(p_notes), '') is null then p_compensation
    when position(lower(btrim(p_compensation)) in lower(p_notes)) > 0 then p_notes
    -- A conflicting existing rate needs officer review, not an automated rewrite.
    when public.extract_source_compensation_note(p_notes) ~ '\$' then p_notes
    else p_notes || E'\n' || p_compensation
  end;
$$;

revoke execute on function public.merge_source_compensation_note(text,text) from public, anon, authenticated;
grant execute on function public.merge_source_compensation_note(text,text) to service_role;


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
      public_notes = public.merge_source_compensation_note(o.public_notes, v_note),
      start_date_text = coalesce(o.start_date_text, v_timing),
      discovery_route = 'official_feed'::public.discovery_route
  where o.id = new.opportunity_id
    and not o.public_safe
    and o.review_status not in ('approved', 'rejected')
    and o.status not in ('closed', 'expired', 'broken_link', 'hidden', 'duplicate', 'not_relevant', 'archive_only');

  return new;
end;
$$;

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
      public_notes = public.merge_source_compensation_note(o.public_notes, v_note),
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
