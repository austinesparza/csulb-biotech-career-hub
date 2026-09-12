-- Expand the public board from its original graduate-only boundary to the Career Hub's
-- reviewed undergraduate, graduate, and mixed student audiences.

-- A source posting may support one opportunity. Multiple source postings may
-- still support the same opportunity when they are genuine corroboration.
create unique index if not exists uq_opportunity_source_links_source_posting
  on public.opportunity_source_links(source_posting_id);

-- PostgreSQL resolves a CASE expression over string literals as text. Cast the
-- result back to the review_tasks.status enum so every review decision can
-- close its associated tasks atomically.
create or replace function public.decide_opportunity_review(
  p_opportunity_id uuid,
  p_decided_by uuid,
  p_decision text,
  p_target_status text,
  p_public_notes text,
  p_make_company_public boolean,
  p_audience_bucket text,
  p_audience_reason text,
  p_graduate_stage text,
  p_final_fields jsonb,
  p_source_confirmed boolean,
  p_public_safe_confirmed boolean
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.opportunities%rowtype;
  v_publish boolean := p_decision = 'approve';
begin
  if not exists (
    select 1 from public.officers
    where user_id = p_decided_by and is_active
  ) then
    raise exception 'active officer required';
  end if;

  select * into v_opportunity
  from public.opportunities
  where id = p_opportunity_id
  for update;

  if v_opportunity.id is null then
    raise exception 'opportunity not found';
  end if;

  if p_decision not in ('approve', 'archive', 'reject') then
    raise exception 'invalid review decision';
  end if;

  if p_decision <> 'reject' and (not p_source_confirmed or not p_public_safe_confirmed) then
    raise exception 'source and public-safety confirmations are required';
  end if;

  if trim(coalesce(p_audience_reason, '')) = '' then
    raise exception 'audience reason is required';
  end if;

  if v_publish then
    if p_target_status not in ('open_verified', 'open_unverified') then
      raise exception 'invalid publish status';
    end if;
    if not (
      (p_audience_bucket = 'undergraduate' and p_graduate_stage = 'not_msc')
      or (
        p_audience_bucket in ('graduate', 'mixed')
        and p_graduate_stage in (
          'msc_year_1', 'msc_year_2', 'msc_any',
          'mixed_graduate', 'graduate_unspecified'
        )
      )
    ) then
      raise exception 'a publishable student audience and matching stage are required';
    end if;

    update public.opportunities
    set status = p_target_status::public.opportunity_status,
        review_status = 'approved',
        public_safe = true,
        public_notes = nullif(trim(coalesce(p_public_notes, '')), ''),
        audience_bucket = p_audience_bucket::public.audience_bucket,
        audience_reason = trim(p_audience_reason),
        graduate_stage = p_graduate_stage::public.graduate_stage,
        eligibility_status = 'confirmed',
        eligibility_evidence = trim(p_audience_reason),
        source_check_result = case
          when p_target_status = 'open_verified' then 'open'::public.source_check_result
          else source_check_result
        end,
        scientific_lanes = coalesce(
          array(select jsonb_array_elements_text(coalesce(p_final_fields->'scientific_lanes', '[]'::jsonb))),
          '{}'
        ),
        job_functions = coalesce(
          array(select jsonb_array_elements_text(coalesce(p_final_fields->'job_functions', '[]'::jsonb))),
          '{}'
        ),
        methods = coalesce(
          array(select jsonb_array_elements_text(coalesce(p_final_fields->'methods', '[]'::jsonb))),
          '{}'
        ),
        last_checked_at = case
          when p_target_status = 'open_verified' then now()
          else last_checked_at
        end
    where id = p_opportunity_id;

    if p_make_company_public and v_opportunity.company_id is not null then
      update public.companies set public_safe = true
      where id = v_opportunity.company_id;
    end if;
  elsif p_decision = 'archive' then
    if p_audience_bucket not in ('special', 'adjacent', 'ineligible') then
      raise exception 'invalid archive bucket';
    end if;
    update public.opportunities
    set status = 'archive_only',
        review_status = 'approved',
        public_safe = false,
        audience_bucket = p_audience_bucket::public.audience_bucket,
        audience_reason = trim(p_audience_reason),
        graduate_stage = p_graduate_stage::public.graduate_stage,
        eligibility_status = case
          when p_audience_bucket = 'ineligible' then 'not_eligible'::public.eligibility_status
          else 'possible'::public.eligibility_status
        end,
        eligibility_evidence = trim(p_audience_reason)
    where id = p_opportunity_id;
  else
    if p_target_status not in ('not_relevant', 'hidden') then
      raise exception 'invalid rejection status';
    end if;
    update public.opportunities
    set status = p_target_status::public.opportunity_status,
        review_status = 'rejected',
        public_safe = false,
        audience_bucket = p_audience_bucket::public.audience_bucket,
        audience_reason = trim(p_audience_reason),
        graduate_stage = p_graduate_stage::public.graduate_stage
    where id = p_opportunity_id;
  end if;

  update public.review_tasks
  set status = (
        case when p_decision = 'reject' then 'dismissed' else 'done' end
      )::public.task_status,
      resolved_at = now(),
      decided_by = p_decided_by,
      decision_json = jsonb_build_object(
        'decision', p_decision,
        'target_status', p_target_status,
        'audience_bucket', p_audience_bucket,
        'audience_reason', trim(p_audience_reason),
        'graduate_stage', p_graduate_stage,
        'final_fields', coalesce(p_final_fields, '{}'::jsonb)
      )
  where (
      (entity_table = 'opportunities' and entity_id = p_opportunity_id)
      or (
        entity_table = 'source_postings'
        and entity_id in (
          select source_posting_id
          from public.opportunity_source_links
          where opportunity_id = p_opportunity_id
        )
      )
    )
    and status in ('open', 'in_progress');
end;
$$;

revoke execute on function public.decide_opportunity_review(
  uuid, uuid, text, text, text, boolean, text, text, text, jsonb, boolean, boolean
) from public, anon, authenticated;
grant execute on function public.decide_opportunity_review(
  uuid, uuid, text, text, text, boolean, text, text, text, jsonb, boolean, boolean
) to service_role;

create or replace view public.public_opportunities as
select o.id, c.name as company_name, o.title, o.posting_url, o.location,
       o.eligibility, o.focus_area, o.deadline, o.deadline_text, o.start_date_text,
       o.paid_status, o.application_type, o.status, o.public_notes,
       o.relevance_score, o.last_checked_at, o.first_seen_at,
       s.name as source_name, o.audience_bucket, o.audience_reason,
       o.scientific_lanes, o.job_functions, o.methods, o.industry_context,
       o.graduate_stage, o.eligibility_status, o.eligibility_evidence,
       o.continued_enrollment_required, o.graduation_window_start,
       o.graduation_window_end, o.work_authorization, o.application_opened_at,
       o.date_basis, o.source_check_result, o.discovery_route
from public.opportunities o
join public.companies c on c.id = o.company_id and c.public_safe
left join public.source_records s on s.id = o.source_record_id and s.public_safe
where o.public_safe and o.review_status = 'approved'
  and o.status in ('open_verified','open_unverified')
  and (
    (o.audience_bucket = 'undergraduate' and o.graduate_stage = 'not_msc')
    or (
      o.audience_bucket in ('graduate', 'mixed')
      and o.graduate_stage in (
        'msc_year_1', 'msc_year_2', 'msc_any',
        'mixed_graduate', 'graduate_unspecified'
      )
    )
  )
  and o.eligibility_status in ('confirmed', 'possible');

grant select on public.public_opportunities to anon, authenticated;

create or replace view public.public_companies as
select c.id, c.name, c.website, c.location, c.industry_tags, c.description,
       (
         select count(*)
         from public.opportunities o
         where o.company_id = c.id
           and o.public_safe
           and o.review_status = 'approved'
           and o.status in ('open_verified', 'open_unverified')
           and (
             (o.audience_bucket = 'undergraduate' and o.graduate_stage = 'not_msc')
             or (
               o.audience_bucket in ('graduate', 'mixed')
               and o.graduate_stage in (
                 'msc_year_1', 'msc_year_2', 'msc_any',
                 'mixed_graduate', 'graduate_unspecified'
               )
             )
           )
           and o.eligibility_status in ('confirmed', 'possible')
       ) as open_count
from public.companies c
where c.public_safe
  and exists (
    select 1
    from public.opportunities o
    where o.company_id = c.id
      and o.public_safe
      and o.review_status = 'approved'
      and o.status in ('open_verified', 'open_unverified')
      and (
        (o.audience_bucket = 'undergraduate' and o.graduate_stage = 'not_msc')
        or (
          o.audience_bucket in ('graduate', 'mixed')
          and o.graduate_stage in (
            'msc_year_1', 'msc_year_2', 'msc_any',
            'mixed_graduate', 'graduate_unspecified'
          )
        )
      )
      and o.eligibility_status in ('confirmed', 'possible')
  );

grant select on public.public_companies to anon, authenticated;

create or replace function public.revise_published_opportunity(
  p_opportunity_id uuid,
  p_changed_by uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_reason text,
  p_changes jsonb default '{}'::jsonb,
  p_source_confirmed boolean default false,
  p_public_safe_confirmed boolean default false,
  p_restore_revision_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_opportunity public.opportunities%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_restore jsonb;
  v_revision_id uuid;
  v_revision_number integer;
  v_allowed_keys text[] := array[
    'title', 'posting_url', 'location', 'eligibility', 'focus_area',
    'deadline', 'deadline_text', 'start_date_text', 'paid_status',
    'application_type', 'status', 'public_notes', 'audience_bucket',
    'audience_reason', 'graduate_stage', 'eligibility_evidence',
    'work_authorization', 'dedupe_key', 'family_key'
  ];
begin
  if not exists (
    select 1 from public.officers
    where user_id = p_changed_by and is_active
  ) then
    raise exception 'active officer required';
  end if;

  if p_action not in ('correction', 'unpublish', 'restore') then
    raise exception 'invalid revision action';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) not between 8 and 500 then
    raise exception 'a correction reason between 8 and 500 characters is required';
  end if;

  select * into v_opportunity
  from public.opportunities
  where id = p_opportunity_id
  for update;

  if v_opportunity.id is null then
    raise exception 'opportunity not found';
  end if;
  if v_opportunity.review_status <> 'approved' then
    raise exception 'only officer-approved opportunities can be revised here';
  end if;
  if v_opportunity.updated_at <> p_expected_updated_at then
    raise exception 'this record changed after the page loaded; refresh before saving';
  end if;

  v_before := to_jsonb(v_opportunity);

  if p_action = 'correction' then
    if not v_opportunity.public_safe
       or v_opportunity.status not in ('open_verified', 'open_unverified') then
      raise exception 'only a currently published opportunity can be corrected';
    end if;
    if not p_source_confirmed or not p_public_safe_confirmed then
      raise exception 'source and public-safety confirmations are required';
    end if;
    if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object'
       or (coalesce(p_changes, '{}'::jsonb) - v_allowed_keys) <> '{}'::jsonb then
      raise exception 'changes contain a field that is not editable';
    end if;

    update public.opportunities
    set title = case when p_changes ? 'title' then trim(p_changes->>'title') else title end,
        posting_url = case when p_changes ? 'posting_url' then nullif(trim(coalesce(p_changes->>'posting_url', '')), '') else posting_url end,
        location = case when p_changes ? 'location' then nullif(trim(coalesce(p_changes->>'location', '')), '') else location end,
        eligibility = case when p_changes ? 'eligibility' then nullif(trim(coalesce(p_changes->>'eligibility', '')), '') else eligibility end,
        focus_area = case when p_changes ? 'focus_area' then nullif(trim(coalesce(p_changes->>'focus_area', '')), '') else focus_area end,
        deadline = case when p_changes ? 'deadline' then nullif(trim(coalesce(p_changes->>'deadline', '')), '')::date else deadline end,
        deadline_text = case when p_changes ? 'deadline_text' then nullif(trim(coalesce(p_changes->>'deadline_text', '')), '') else deadline_text end,
        start_date_text = case when p_changes ? 'start_date_text' then nullif(trim(coalesce(p_changes->>'start_date_text', '')), '') else start_date_text end,
        paid_status = case when p_changes ? 'paid_status' then (p_changes->>'paid_status')::public.paid_status else paid_status end,
        application_type = case when p_changes ? 'application_type' then nullif(trim(coalesce(p_changes->>'application_type', '')), '') else application_type end,
        status = case when p_changes ? 'status' then (p_changes->>'status')::public.opportunity_status else status end,
        public_notes = case when p_changes ? 'public_notes' then nullif(trim(coalesce(p_changes->>'public_notes', '')), '') else public_notes end,
        audience_bucket = case when p_changes ? 'audience_bucket' then (p_changes->>'audience_bucket')::public.audience_bucket else audience_bucket end,
        audience_reason = case when p_changes ? 'audience_reason' then nullif(trim(coalesce(p_changes->>'audience_reason', '')), '') else audience_reason end,
        graduate_stage = case when p_changes ? 'graduate_stage' then (p_changes->>'graduate_stage')::public.graduate_stage else graduate_stage end,
        eligibility_evidence = case when p_changes ? 'eligibility_evidence' then nullif(trim(coalesce(p_changes->>'eligibility_evidence', '')), '') else eligibility_evidence end,
        work_authorization = case when p_changes ? 'work_authorization' then nullif(trim(coalesce(p_changes->>'work_authorization', '')), '') else work_authorization end,
        dedupe_key = case when p_changes ? 'dedupe_key' then nullif(trim(coalesce(p_changes->>'dedupe_key', '')), '') else dedupe_key end,
        family_key = case when p_changes ? 'family_key' then nullif(trim(coalesce(p_changes->>'family_key', '')), '') else family_key end,
        last_checked_at = now()
    where id = p_opportunity_id;
  elsif p_action = 'unpublish' then
    if not v_opportunity.public_safe
       or v_opportunity.status not in ('open_verified', 'open_unverified') then
      raise exception 'this opportunity is not currently published';
    end if;
    update public.opportunities
    set status = 'hidden', public_safe = false
    where id = p_opportunity_id;
  else
    if p_restore_revision_id is null then
      raise exception 'a revision to restore is required';
    end if;

    select before_snapshot into v_restore
    from public.opportunity_revisions
    where id = p_restore_revision_id and opportunity_id = p_opportunity_id;

    if v_restore is null then
      raise exception 'revision not found for this opportunity';
    end if;
    if (v_restore->>'public_safe')::boolean
       and (not p_source_confirmed or not p_public_safe_confirmed) then
      raise exception 'source and public-safety confirmations are required to restore publication';
    end if;

    update public.opportunities
    set title = v_restore->>'title',
        posting_url = v_restore->>'posting_url',
        location = v_restore->>'location',
        eligibility = v_restore->>'eligibility',
        focus_area = v_restore->>'focus_area',
        deadline = (v_restore->>'deadline')::date,
        deadline_text = v_restore->>'deadline_text',
        start_date_text = v_restore->>'start_date_text',
        paid_status = (v_restore->>'paid_status')::public.paid_status,
        application_type = v_restore->>'application_type',
        status = (v_restore->>'status')::public.opportunity_status,
        public_notes = v_restore->>'public_notes',
        audience_bucket = (v_restore->>'audience_bucket')::public.audience_bucket,
        audience_reason = v_restore->>'audience_reason',
        graduate_stage = (v_restore->>'graduate_stage')::public.graduate_stage,
        eligibility_evidence = v_restore->>'eligibility_evidence',
        work_authorization = v_restore->>'work_authorization',
        dedupe_key = v_restore->>'dedupe_key',
        family_key = v_restore->>'family_key',
        review_status = (v_restore->>'review_status')::public.review_status,
        public_safe = (v_restore->>'public_safe')::boolean,
        last_checked_at = case
          when (v_restore->>'public_safe')::boolean then now()
          else (v_restore->>'last_checked_at')::timestamptz
        end
    where id = p_opportunity_id;
  end if;

  select * into v_opportunity
  from public.opportunities
  where id = p_opportunity_id;

  if v_opportunity.public_safe then
    if v_opportunity.status not in ('open_verified', 'open_unverified')
       or not (
         (v_opportunity.audience_bucket = 'undergraduate' and v_opportunity.graduate_stage = 'not_msc')
         or (
           v_opportunity.audience_bucket in ('graduate', 'mixed')
           and v_opportunity.graduate_stage in (
             'msc_year_1', 'msc_year_2', 'msc_any',
             'mixed_graduate', 'graduate_unspecified'
           )
         )
       )
       or v_opportunity.eligibility_status not in ('confirmed', 'possible') then
      raise exception 'the corrected record no longer satisfies the public board boundary';
    end if;
    if char_length(trim(v_opportunity.title)) not between 2 and 300 then
      raise exception 'title must be between 2 and 300 characters';
    end if;
    if v_opportunity.posting_url is not null
       and v_opportunity.posting_url !~* '^https?://' then
      raise exception 'posting URL must use http or https';
    end if;
    if char_length(trim(coalesce(v_opportunity.audience_reason, ''))) < 8 then
      raise exception 'audience evidence is required for a public record';
    end if;
  end if;

  if exists (
    select 1 from public.opportunities other
    where other.id <> v_opportunity.id
      and (
        (v_opportunity.posting_url is not null and other.posting_url = v_opportunity.posting_url)
        or (v_opportunity.dedupe_key is not null and other.dedupe_key = v_opportunity.dedupe_key)
      )
  ) then
    raise exception 'the corrected title or link duplicates another opportunity';
  end if;

  v_after := to_jsonb(v_opportunity);
  select coalesce(max(revision_number), 0) + 1
    into v_revision_number
  from public.opportunity_revisions
  where opportunity_id = p_opportunity_id;

  insert into public.opportunity_revisions (
    opportunity_id, revision_number, action, reason, changed_by,
    restored_revision_id, before_snapshot, after_snapshot
  ) values (
    p_opportunity_id, v_revision_number, p_action, trim(p_reason), p_changed_by,
    case when p_action = 'restore' then p_restore_revision_id end,
    v_before, v_after
  ) returning id into v_revision_id;

  return v_revision_id;
end;
$$;

revoke execute on function public.revise_published_opportunity(
  uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.revise_published_opportunity(
  uuid, uuid, timestamptz, text, text, jsonb, boolean, boolean, uuid
) to service_role;
