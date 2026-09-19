-- Append-only multi-label classification feedback. The deterministic taxonomy
-- proposes tags; an officer's final review remains the publication authority.

create table public.opportunity_classification_feedback (
  id                         uuid primary key default gen_random_uuid(),
  opportunity_id             uuid not null references public.opportunities(id) on delete restrict,
  extraction_id              uuid references public.pipeline_extractions(id) on delete set null,
  decision                   text not null check (decision in ('approve', 'archive')),
  proposal_source            text not null check (proposal_source in (
                               'deterministic_taxonomy', 'legacy_draft'
                             )),
  taxonomy_version           integer check (taxonomy_version is null or taxonomy_version > 0),
  extraction_schema_version  integer check (
                               extraction_schema_version is null or extraction_schema_version > 0
                             ),
  proposal_model             text,
  prompt_version             text,
  proposed_tags              jsonb not null check (jsonb_typeof(proposed_tags) = 'object'),
  final_tags                 jsonb not null check (jsonb_typeof(final_tags) = 'object'),
  proposal_details           jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(proposal_details) = 'object'),
  context_decisions          jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(context_decisions) = 'object'),
  decided_by                 uuid not null references auth.users(id) on delete restrict,
  created_at                 timestamptz not null default now()
);

create index idx_opportunity_classification_feedback_opportunity_created
  on public.opportunity_classification_feedback(opportunity_id, created_at desc);
create index idx_opportunity_classification_feedback_taxonomy_created
  on public.opportunity_classification_feedback(taxonomy_version, created_at desc)
  where proposal_source = 'deterministic_taxonomy';

alter table public.opportunity_classification_feedback enable row level security;
revoke all on public.opportunity_classification_feedback
  from public, anon, authenticated, service_role;
grant select on public.opportunity_classification_feedback to authenticated;
grant select, insert on public.opportunity_classification_feedback to service_role;

create policy officer_select_opportunity_classification_feedback
  on public.opportunity_classification_feedback for select to authenticated
  using (public.is_officer());

create or replace function public.prevent_classification_feedback_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'classification feedback history is append-only';
end;
$$;

create trigger trg_opportunity_classification_feedback_append_only
  before update or delete on public.opportunity_classification_feedback
  for each row execute function public.prevent_classification_feedback_mutation();

revoke execute on function public.prevent_classification_feedback_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_classification_feedback_mutation()
  to service_role;

-- Replaces the current review transaction without changing its signature. The
-- classification snapshot and the publication decision now commit together.
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
  v_extraction_id uuid;
  v_taxonomy_version integer;
  v_extraction_schema_version integer;
  v_proposal_model text;
  v_prompt_version text;
  v_classification jsonb;
  v_proposed_tags jsonb;
  v_final_tags jsonb;
  v_proposal_source text;
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

  if p_decision <> 'reject' and (
    jsonb_typeof(coalesce(p_final_fields, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_final_fields->'scientific_lanes', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_final_fields->'job_functions', 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_final_fields->'methods', 'null'::jsonb)) <> 'array'
  ) then
    raise exception 'final classification tags must be arrays';
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
        scientific_lanes = array(
          select jsonb_array_elements_text(p_final_fields->'scientific_lanes')
        ),
        job_functions = array(
          select jsonb_array_elements_text(p_final_fields->'job_functions')
        ),
        methods = array(
          select jsonb_array_elements_text(p_final_fields->'methods')
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
        eligibility_evidence = trim(p_audience_reason),
        scientific_lanes = array(
          select jsonb_array_elements_text(p_final_fields->'scientific_lanes')
        ),
        job_functions = array(
          select jsonb_array_elements_text(p_final_fields->'job_functions')
        ),
        methods = array(
          select jsonb_array_elements_text(p_final_fields->'methods')
        )
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

  if p_decision in ('approve', 'archive') then
    select id, taxonomy_version, schema_version, model, prompt_version, classification
      into v_extraction_id, v_taxonomy_version, v_extraction_schema_version,
           v_proposal_model, v_prompt_version, v_classification
    from public.pipeline_extractions
    where opportunity_id = p_opportunity_id
    order by created_at desc, id desc
    limit 1;

    if v_extraction_id is not null then
      v_proposal_source := 'deterministic_taxonomy';
      v_proposed_tags := jsonb_build_object(
        'scientific_lanes', jsonb_path_query_array(v_classification, '$.lanes[*].label'),
        'job_functions', jsonb_path_query_array(v_classification, '$.functions[*].label'),
        'methods', jsonb_path_query_array(v_classification, '$.methods.*[*]')
      );
    else
      v_proposal_source := 'legacy_draft';
      v_proposed_tags := jsonb_build_object(
        'scientific_lanes', to_jsonb(coalesce(v_opportunity.scientific_lanes, '{}')),
        'job_functions', to_jsonb(coalesce(v_opportunity.job_functions, '{}')),
        'methods', to_jsonb(coalesce(v_opportunity.methods, '{}'))
      );
      v_classification := '{}'::jsonb;
    end if;

    v_final_tags := jsonb_build_object(
      'scientific_lanes', p_final_fields->'scientific_lanes',
      'job_functions', p_final_fields->'job_functions',
      'methods', p_final_fields->'methods'
    );

    insert into public.opportunity_classification_feedback (
      opportunity_id, extraction_id, decision, proposal_source,
      taxonomy_version, extraction_schema_version, proposal_model, prompt_version,
      proposed_tags, final_tags, proposal_details, context_decisions, decided_by
    ) values (
      p_opportunity_id, v_extraction_id, p_decision, v_proposal_source,
      v_taxonomy_version, v_extraction_schema_version, v_proposal_model, v_prompt_version,
      v_proposed_tags, v_final_tags, coalesce(v_classification, '{}'::jsonb),
      jsonb_build_object(
        'audience_bucket', p_audience_bucket,
        'graduate_stage', p_graduate_stage,
        'excluded_from_tag_training', true
      ),
      p_decided_by
    );
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

comment on table public.opportunity_classification_feedback is
  'Append-only proposed-versus-final multi-label tag snapshots. Officer-final tags remain authoritative; audience and eligibility decisions are excluded from tag training.';
