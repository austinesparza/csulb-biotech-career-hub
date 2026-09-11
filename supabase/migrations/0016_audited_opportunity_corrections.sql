-- Officer-only corrections for records that have already crossed the publication
-- boundary. Every mutation stores immutable before/after snapshots and can be
-- reversed without deleting history.

create table if not exists public.opportunity_revisions (
  id                    uuid primary key default gen_random_uuid(),
  opportunity_id        uuid not null references public.opportunities(id) on delete restrict,
  revision_number       integer not null check (revision_number > 0),
  action                 text not null check (action in ('correction', 'unpublish', 'restore')),
  reason                 text not null check (char_length(trim(reason)) between 8 and 500),
  changed_by             uuid not null references auth.users(id) on delete restrict,
  restored_revision_id  uuid references public.opportunity_revisions(id) on delete restrict,
  before_snapshot        jsonb not null check (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot         jsonb not null check (jsonb_typeof(after_snapshot) = 'object'),
  created_at             timestamptz not null default now(),
  unique (opportunity_id, revision_number)
);

create index if not exists idx_opportunity_revisions_history
  on public.opportunity_revisions(opportunity_id, revision_number desc);

alter table public.opportunity_revisions enable row level security;

create policy officer_select_opportunity_revisions
  on public.opportunity_revisions
  for select
  to authenticated
  using (public.is_officer());

revoke all on public.opportunity_revisions from public, anon, authenticated;
grant select on public.opportunity_revisions to authenticated;
grant all on public.opportunity_revisions to service_role;

comment on table public.opportunity_revisions is
  'Append-only officer audit history for published-record corrections, removals, and restores.';

create or replace function public.prevent_opportunity_revision_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'opportunity revision history is append-only';
end;
$$;

create trigger trg_opportunity_revisions_append_only
  before update or delete on public.opportunity_revisions
  for each row execute function public.prevent_opportunity_revision_mutation();

revoke execute on function public.prevent_opportunity_revision_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_opportunity_revision_mutation()
  to service_role;

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
       or v_opportunity.audience_bucket not in ('graduate', 'mixed')
       or v_opportunity.graduate_stage not in (
         'msc_year_1', 'msc_year_2', 'msc_any',
         'mixed_graduate', 'graduate_unspecified'
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
