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
    if p_audience_bucket not in ('graduate', 'mixed') then
      raise exception 'only graduate-accessible records can be published';
    end if;
    if p_graduate_stage not in (
      'msc_year_1', 'msc_year_2', 'msc_any',
      'mixed_graduate', 'graduate_unspecified'
    ) then
      raise exception 'an MSc-accessible stage is required';
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
