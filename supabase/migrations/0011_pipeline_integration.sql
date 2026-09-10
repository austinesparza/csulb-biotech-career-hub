-- Integrate evidence-backed extraction and graduate review into the existing
-- ingestion schema. This migration deliberately reuses the canonical tables
-- created by 0001-0007 instead of creating a parallel pipeline.

do $$ begin
  create type graduate_stage as enum (
    'msc_year_1',
    'msc_year_2',
    'msc_any',
    'mixed_graduate',
    'graduate_unspecified',
    'doctoral_only',
    'not_msc',
    'unknown'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type eligibility_status as enum ('confirmed', 'possible', 'not_eligible', 'unknown');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type date_basis as enum ('stated', 'historical_pattern', 'unknown');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type source_check_result as enum ('open', 'closed', 'changed', 'missing', 'error', 'unknown');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type discovery_route as enum (
    'manual', 'public_submission', 'spreadsheet', 'official_feed',
    'employer_inventory', 'program_page', 'web_search'
  );
exception when duplicate_object then null;
end $$;

alter table public.opportunities
  add column if not exists scientific_lanes text[] not null default '{}',
  add column if not exists job_functions text[] not null default '{}',
  add column if not exists methods text[] not null default '{}',
  add column if not exists industry_context text[] not null default '{}',
  add column if not exists graduate_stage graduate_stage not null default 'unknown',
  add column if not exists eligibility_status eligibility_status not null default 'unknown',
  add column if not exists eligibility_evidence text,
  add column if not exists continued_enrollment_required boolean,
  add column if not exists graduation_window_start date,
  add column if not exists graduation_window_end date,
  add column if not exists work_authorization text,
  add column if not exists application_opened_at date,
  add column if not exists date_basis date_basis not null default 'unknown',
  add column if not exists source_check_result source_check_result not null default 'unknown',
  add column if not exists discovery_route discovery_route not null default 'manual';

do $$ begin
  alter table public.opportunities
    add constraint opportunities_graduation_window_valid
    check (
      graduation_window_start is null or graduation_window_end is null
      or graduation_window_start <= graduation_window_end
    );
exception when duplicate_object then null;
end $$;

-- Fetch-chain state belongs on the approved job-source registry. Sources stay
-- disabled by default under the policy checks established in migration 0003.
alter table public.job_sources
  add column if not exists window_start date,
  add column if not exists window_end date,
  add column if not exists poll_in_window interval not null default '1 day',
  add column if not exists poll_out_window interval not null default '30 days',
  add column if not exists fetch_tier smallint not null default 0
    check (fetch_tier between 0 and 2),
  add column if not exists tier_clean_runs integer not null default 0
    check (tier_clean_runs >= 0),
  add column if not exists tier_reason text,
  add column if not exists tier_changed_at timestamptz;

do $$ begin
  alter table public.job_sources
    add constraint job_sources_window_valid
    check (window_start is null or window_end is null or window_start <= window_end);
exception when duplicate_object then null;
end $$;

alter table public.source_fetch_runs
  add column if not exists fetch_tier smallint check (fetch_tier between 0 and 2),
  add column if not exists tier_attempts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(tier_attempts) = 'array');

-- One extraction is tied to the exact immutable posting version it read.
-- Model output never writes publication fields directly.
create table if not exists public.pipeline_extractions (
  id                         uuid primary key default gen_random_uuid(),
  source_posting_version_id  uuid not null
                               references public.source_posting_versions(id) on delete restrict,
  opportunity_id             uuid references public.opportunities(id) on delete set null,
  created_at                 timestamptz not null default now(),
  model                      text not null check (trim(model) <> ''),
  prompt_version             text not null check (trim(prompt_version) <> ''),
  schema_version             integer not null check (schema_version > 0),
  taxonomy_version           integer not null check (taxonomy_version > 0),
  classification             jsonb not null default '{}'::jsonb
                               check (jsonb_typeof(classification) = 'object'),
  fields                     jsonb not null check (jsonb_typeof(fields) = 'object'),
  bindings                   jsonb not null check (jsonb_typeof(bindings) = 'object'),
  evidence_ok                boolean not null,
  binding_failures           text[] not null default '{}',
  injection_flags            text[] not null default '{}',
  input_tokens               integer check (input_tokens is null or input_tokens >= 0),
  output_tokens              integer check (output_tokens is null or output_tokens >= 0),
  trace_id                   text,
  unique (source_posting_version_id, schema_version, prompt_version)
);

create index if not exists idx_pipeline_extractions_opportunity_created
  on public.pipeline_extractions(opportunity_id, created_at desc);

revoke all on public.pipeline_extractions from anon, authenticated, service_role;
grant select on public.pipeline_extractions to authenticated;
grant select, insert on public.pipeline_extractions to service_role;

-- This diagnostic view exposes only the latest immutable version of each open
-- posting. The version-aware RPC below decides whether that version still needs
-- a particular extraction schema and prompt combination.
create or replace view public.pipeline_extraction_inbox
with (security_invoker = true) as
select distinct on (sp.id)
       spv.id as source_posting_version_id,
       sp.id as source_posting_id,
       osl.opportunity_id,
       coalesce(sp.employer_name_raw, sp.employer_name_normalized, '') as employer,
       coalesce(sp.title_raw, sp.title_normalized, '') as title,
       sp.canonical_url,
       sp.relevance_score,
       spv.normalized_json->>'descriptionText' as raw_text,
       spv.created_at
from public.source_postings sp
join public.source_posting_versions spv on spv.source_posting_id = sp.id
left join public.opportunity_source_links osl
  on osl.source_posting_id = sp.id and osl.is_primary
where sp.current_status in ('open', 'reopened', 'unknown')
order by sp.id, spv.created_at desc;

revoke all on public.pipeline_extraction_inbox from public, anon, authenticated;
grant select on public.pipeline_extraction_inbox to service_role;

create or replace function public.pending_pipeline_extractions(
  p_schema_version integer,
  p_prompt_version text,
  p_limit integer default 25
)
returns table (
  source_posting_version_id uuid,
  source_posting_id uuid,
  opportunity_id uuid,
  employer text,
  title text,
  canonical_url text,
  relevance_score integer,
  raw_text text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select inbox.source_posting_version_id,
         inbox.source_posting_id,
         inbox.opportunity_id,
         inbox.employer,
         inbox.title,
         inbox.canonical_url,
         inbox.relevance_score,
         inbox.raw_text,
         inbox.created_at
  from public.pipeline_extraction_inbox inbox
  where inbox.raw_text is not null
    and not exists (
      select 1
      from public.pipeline_extractions extraction
      where extraction.source_posting_version_id = inbox.source_posting_version_id
        and extraction.schema_version = p_schema_version
        and extraction.prompt_version = p_prompt_version
    )
  order by inbox.created_at, inbox.source_posting_version_id
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke execute on function public.pending_pipeline_extractions(integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.pending_pipeline_extractions(integer, text, integer)
  to service_role;

alter table public.review_tasks
  add column if not exists extraction_id uuid
    references public.pipeline_extractions(id) on delete set null,
  add column if not exists priority integer not null default 100,
  add column if not exists decision_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(decision_json) = 'object'),
  add column if not exists decided_by uuid references auth.users(id) on delete set null;

alter table public.pipeline_extractions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pipeline_extractions'
      and policyname = 'officer_select_pipeline_extractions'
  ) then
    create policy officer_select_pipeline_extractions
      on public.pipeline_extractions for select to authenticated
      using (public.is_officer());
  end if;
end $$;

create or replace function public.persist_pipeline_extraction(
  p_source_posting_version_id uuid,
  p_opportunity_id uuid,
  p_model text,
  p_prompt_version text,
  p_schema_version integer,
  p_taxonomy_version integer,
  p_classification jsonb,
  p_fields jsonb,
  p_bindings jsonb,
  p_evidence_ok boolean,
  p_binding_failures text[],
  p_injection_flags text[],
  p_input_tokens integer,
  p_output_tokens integer,
  p_trace_id text,
  p_priority integer
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_extraction_id uuid;
  v_source_posting_id uuid;
begin
  select source_posting_id into v_source_posting_id
  from public.source_posting_versions
  where id = p_source_posting_version_id;

  if v_source_posting_id is null then
    raise exception 'source posting version not found';
  end if;

  if p_opportunity_id is not null and not exists (
    select 1 from public.opportunity_source_links
    where opportunity_id = p_opportunity_id
      and source_posting_id = v_source_posting_id
  ) then
    raise exception 'opportunity is not linked to source posting';
  end if;

  insert into public.pipeline_extractions (
    source_posting_version_id, opportunity_id, model, prompt_version,
    schema_version, taxonomy_version, classification, fields, bindings,
    evidence_ok, binding_failures, injection_flags, input_tokens,
    output_tokens, trace_id
  ) values (
    p_source_posting_version_id, p_opportunity_id, p_model, p_prompt_version,
    p_schema_version, p_taxonomy_version, coalesce(p_classification, '{}'::jsonb),
    p_fields, p_bindings, p_evidence_ok, coalesce(p_binding_failures, '{}'),
    coalesce(p_injection_flags, '{}'), p_input_tokens, p_output_tokens, p_trace_id
  )
  on conflict (source_posting_version_id, schema_version, prompt_version)
  do nothing
  returning id into v_extraction_id;

  if v_extraction_id is null then
    select id into v_extraction_id
    from public.pipeline_extractions
    where source_posting_version_id = p_source_posting_version_id
      and schema_version = p_schema_version
      and prompt_version = p_prompt_version;
  end if;

  -- The canonical ingestion bridge owns task creation (source_new,
  -- source_changed, or source_reopened) and keys those tasks to source_postings.
  -- Extraction only enriches those existing tasks, so model output can never
  -- invent a second review workflow.
  update public.review_tasks
  set extraction_id = v_extraction_id,
      priority = least(priority, greatest(1, p_priority))
  where entity_table = 'source_postings'
    and entity_id = v_source_posting_id
    and status in ('open', 'in_progress');

  return v_extraction_id;
end;
$$;

revoke execute on function public.persist_pipeline_extraction(
  uuid, uuid, text, text, integer, integer, jsonb, jsonb, jsonb,
  boolean, text[], text[], integer, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.persist_pipeline_extraction(
  uuid, uuid, text, text, integer, integer, jsonb, jsonb, jsonb,
  boolean, text[], text[], integer, integer, text, integer
) to service_role;

-- Preserve reviewed graduate records when this migration is applied after the
-- earlier audience migration. No specific year is inferred.
update public.opportunities
set graduate_stage = 'graduate_unspecified',
    eligibility_status = case
      when review_status = 'approved' then 'possible'::public.eligibility_status
      else eligibility_status
    end,
    eligibility_evidence = coalesce(eligibility_evidence, audience_reason, eligibility)
where graduate_stage = 'unknown'
  and audience_bucket in ('graduate', 'mixed');

-- One database transaction records the officer decision, closes every open task
-- for the opportunity, and optionally makes the company public.
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
  set status = case when p_decision = 'reject' then 'dismissed' else 'done' end,
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

create index if not exists idx_opportunities_graduate_stage
  on public.opportunities(graduate_stage, status, review_status, public_safe);

-- The public board is intentionally MSc-focused. Doctoral-only, adjacent,
-- special-affiliation, and undergraduate-only records remain available to
-- officers as evidence but cannot enter this view.
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
  and o.audience_bucket in ('graduate', 'mixed')
  and o.graduate_stage in (
    'msc_year_1', 'msc_year_2', 'msc_any',
    'mixed_graduate', 'graduate_unspecified'
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
           and o.audience_bucket in ('graduate', 'mixed')
           and o.graduate_stage in (
             'msc_year_1', 'msc_year_2', 'msc_any',
             'mixed_graduate', 'graduate_unspecified'
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
      and o.audience_bucket in ('graduate', 'mixed')
      and o.graduate_stage in (
        'msc_year_1', 'msc_year_2', 'msc_any',
        'mixed_graduate', 'graduate_unspecified'
      )
      and o.eligibility_status in ('confirmed', 'possible')
  );

grant select on public.public_companies to anon, authenticated;

comment on table public.pipeline_extractions is
  'Model output bound to the immutable source posting version it read. Never a publication source.';
comment on column public.opportunities.date_basis is
  'Whether timing is source-stated, inferred from historical cycles, or unknown.';
