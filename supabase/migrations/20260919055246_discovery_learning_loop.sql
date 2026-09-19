-- Private, officer-labelled learning loop for discovery recall and ranking.
-- Learned output is advisory only. It cannot approve or publish opportunities.

create table public.discovery_feedback (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.discovery_leads(id) on delete restrict,
  label           text not null check (label in (
                    'relevant', 'irrelevant', 'duplicate', 'closed', 'unverifiable'
                  )),
  reason          text not null check (char_length(trim(reason)) between 8 and 1000),
  label_source    text not null check (label_source in (
                    'officer', 'promotion', 'missed_role'
                  )),
  feature_schema_version smallint not null check (feature_schema_version > 0),
  feature_snapshot jsonb not null check (jsonb_typeof(feature_snapshot) = 'object'),
  query_family    text not null check (char_length(trim(query_family)) between 1 and 240),
  decided_by      uuid not null references auth.users(id) on delete restrict,
  created_at      timestamptz not null default now()
);

create index idx_discovery_feedback_lead_created
  on public.discovery_feedback(lead_id, created_at desc);
create index idx_discovery_feedback_label_created
  on public.discovery_feedback(label, created_at desc);

create table public.discovery_model_versions (
  id                      uuid primary key default gen_random_uuid(),
  algorithm               text not null check (algorithm = 'logistic_regression_v1'),
  feature_schema_version  smallint not null check (feature_schema_version > 0),
  trained_through         timestamptz not null,
  training_rows           integer not null check (training_rows >= 0),
  positive_rows           integer not null check (positive_rows >= 0),
  negative_rows           integer not null check (negative_rows >= 0),
  model                   jsonb not null check (jsonb_typeof(model) = 'object'),
  metrics                 jsonb not null check (jsonb_typeof(metrics) = 'object'),
  status                  text not null default 'shadow'
                            check (status in ('shadow', 'eligible', 'retired')),
  created_at              timestamptz not null default now(),
  check (positive_rows + negative_rows = training_rows)
);

create index idx_discovery_model_versions_status_created
  on public.discovery_model_versions(status, created_at desc);

create table public.discovery_lead_predictions (
  lead_id          uuid not null references public.discovery_leads(id) on delete restrict,
  model_id         uuid not null references public.discovery_model_versions(id) on delete restrict,
  probability      double precision not null check (probability between 0 and 1),
  feature_snapshot jsonb not null check (jsonb_typeof(feature_snapshot) = 'object'),
  created_at       timestamptz not null default now(),
  primary key (lead_id, model_id)
);

create index idx_discovery_lead_predictions_model_probability
  on public.discovery_lead_predictions(model_id, probability desc);

alter table public.discovery_feedback enable row level security;
alter table public.discovery_model_versions enable row level security;
alter table public.discovery_lead_predictions enable row level security;

revoke all on public.discovery_feedback from public, anon, authenticated, service_role;
revoke all on public.discovery_model_versions from public, anon, authenticated, service_role;
revoke all on public.discovery_lead_predictions from public, anon, authenticated, service_role;

grant select on public.discovery_feedback,
  public.discovery_model_versions,
  public.discovery_lead_predictions to authenticated;
grant select, insert on public.discovery_feedback to service_role;
grant select, insert on public.discovery_model_versions to service_role;
grant select, insert, update on public.discovery_lead_predictions to service_role;

create policy officer_select_discovery_feedback
  on public.discovery_feedback for select to authenticated
  using (public.is_officer());
create policy officer_select_discovery_model_versions
  on public.discovery_model_versions for select to authenticated
  using (public.is_officer());
create policy officer_select_discovery_lead_predictions
  on public.discovery_lead_predictions for select to authenticated
  using (public.is_officer());

create or replace function public.prevent_discovery_learning_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception 'discovery learning history is append-only';
end;
$$;

create trigger trg_discovery_feedback_append_only
  before update or delete on public.discovery_feedback
  for each row execute function public.prevent_discovery_learning_history_mutation();
create trigger trg_discovery_model_versions_append_only
  before update or delete on public.discovery_model_versions
  for each row execute function public.prevent_discovery_learning_history_mutation();

revoke execute on function public.prevent_discovery_learning_history_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_discovery_learning_history_mutation()
  to service_role;

create or replace function public.record_discovery_feedback(
  p_lead_id uuid,
  p_decided_by uuid,
  p_label text,
  p_reason text,
  p_label_source text,
  p_archive_lead boolean,
  p_feature_schema_version smallint,
  p_feature_snapshot jsonb,
  p_query_family text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_feedback_id uuid;
  v_status text;
  v_task_id uuid;
  v_title text;
  v_original_url text;
begin
  if not exists (
    select 1 from public.officers
    where user_id = p_decided_by and is_active
  ) then
    raise exception 'active officer required';
  end if;
  if p_label not in ('relevant', 'irrelevant', 'duplicate', 'closed', 'unverifiable') then
    raise exception 'invalid discovery feedback label';
  end if;
  if p_label_source not in ('officer', 'promotion', 'missed_role') then
    raise exception 'invalid discovery feedback source';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 8 and 1000 then
    raise exception 'feedback reason must be from 8 to 1000 characters';
  end if;
  if p_feature_schema_version is null or p_feature_schema_version < 1
     or jsonb_typeof(coalesce(p_feature_snapshot, 'null'::jsonb)) <> 'object'
     or char_length(trim(coalesce(p_query_family, ''))) not between 1 and 240 then
    raise exception 'valid frozen features and query family are required';
  end if;
  if p_archive_lead and p_label = 'relevant' then
    raise exception 'relevant feedback cannot archive a lead';
  end if;

  select officer_status, latest_title, original_url
  into v_status, v_title, v_original_url
  from public.discovery_leads
  where id = p_lead_id
  for update;
  if v_status is null then
    raise exception 'discovery lead not found';
  end if;

  insert into public.discovery_feedback (
    lead_id, label, reason, label_source, feature_schema_version,
    feature_snapshot, query_family, decided_by
  ) values (
    p_lead_id, p_label, trim(p_reason), p_label_source, p_feature_schema_version,
    p_feature_snapshot, trim(p_query_family), p_decided_by
  ) returning id into v_feedback_id;

  if p_archive_lead then
    if v_status not in ('new', 'in_review') then
      raise exception 'only active discovery leads can be archived';
    end if;
    update public.discovery_leads
    set officer_status = 'archived',
        archive_reason = concat('Officer feedback: ', trim(p_reason)),
        updated_at = now()
    where id = p_lead_id;

    update public.review_tasks
    set status = 'dismissed',
        resolved_at = now(),
        decided_by = p_decided_by
    where entity_table = 'discovery_leads'
      and entity_id = p_lead_id
      and status in ('open', 'in_progress');
  elsif p_label = 'relevant'
    and (
      v_status = 'new'
      or (v_status = 'archived' and p_label_source = 'missed_role')
    ) then
    update public.discovery_leads
    set officer_status = 'in_review',
        archive_reason = case
          when v_status = 'archived'
            then 'Officer reported this as a role the automated discovery run missed.'
          else archive_reason
        end,
        updated_at = now()
    where id = p_lead_id;

    select id into v_task_id
    from public.review_tasks
    where entity_table = 'discovery_leads'
      and entity_id = p_lead_id
      and status in ('open', 'in_progress')
    order by created_at desc
    limit 1
    for update;

    if v_task_id is null and v_status = 'archived' then
      select id into v_task_id
      from public.review_tasks
      where entity_table = 'discovery_leads'
        and entity_id = p_lead_id
        and status = 'dismissed'
      order by resolved_at desc nulls last, created_at desc
      limit 1
      for update;
    end if;

    if v_task_id is not null then
      update public.review_tasks
      set status = 'in_progress',
          assigned_to = p_decided_by,
          resolved_at = null,
          decided_by = null
      where id = v_task_id;
    else
      insert into public.review_tasks(
        task_type, entity_table, entity_id, status, assigned_to, priority, notes
      ) values (
        'source_new', 'discovery_leads', p_lead_id, 'in_progress',
        p_decided_by, 100,
        concat(
          'Discovery lead: ', coalesce(nullif(trim(v_title), ''), 'Untitled lead'),
          E'\n', v_original_url
        )
      );
    end if;
  end if;

  return v_feedback_id;
end;
$$;

revoke execute on function public.record_discovery_feedback(
  uuid, uuid, text, text, text, boolean, smallint, jsonb, text
) from public, anon, authenticated;
grant execute on function public.record_discovery_feedback(
  uuid, uuid, text, text, text, boolean, smallint, jsonb, text
) to service_role;

comment on table public.discovery_feedback is
  'Append-only officer labels for discovery evaluation. Only relevant and irrelevant labels train the binary shadow ranker.';
comment on table public.discovery_model_versions is
  'Private, versioned discovery models and holdout metrics. Models are advisory and cannot publish.';
comment on table public.discovery_lead_predictions is
  'Private shadow predictions attached to a specific model version and feature snapshot.';
