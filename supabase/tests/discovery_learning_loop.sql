\set ON_ERROR_STOP on

begin;

do $$
declare
  table_name text;
  v_user uuid := gen_random_uuid();
  v_lead uuid;
  v_feedback uuid;
begin
  foreach table_name in array array[
    'discovery_feedback',
    'discovery_model_versions',
    'discovery_lead_predictions'
  ] loop
    if not exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
    if has_table_privilege('anon', format('public.%s', table_name), 'SELECT')
       or has_table_privilege('anon', format('public.%s', table_name), 'INSERT')
       or has_table_privilege('anon', format('public.%s', table_name), 'UPDATE')
       or has_table_privilege('anon', format('public.%s', table_name), 'DELETE') then
      raise exception 'anon has privileges on public.%', table_name;
    end if;
  end loop;

  if has_function_privilege(
    'anon',
    'public.record_discovery_feedback(uuid,uuid,text,text,text,boolean,smallint,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'anon can execute record_discovery_feedback';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.record_discovery_feedback(uuid,uuid,text,text,text,boolean,smallint,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'authenticated can execute record_discovery_feedback directly';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.record_discovery_feedback(uuid,uuid,text,text,text,boolean,smallint,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role cannot execute record_discovery_feedback';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user,
    'authenticated', 'authenticated', 'discovery-learning-test@example.edu', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.officers (user_id, display_name)
  values (v_user, 'Discovery Learning Test Officer');

  insert into public.discovery_leads (
    lead_key, route, original_url, resolution, archive_reason,
    original_reachable, officer_status, first_seen_at, last_seen_at,
    latest_title, employer_hint
  ) values (
    repeat('a', 64), 'linkedin_lead', 'https://www.linkedin.com/jobs/view/123',
    'linkedin_only', 'Previously dismissed during review.', true, 'archived',
    now() - interval '1 day', now(), 'Research Intern', 'Example Bio'
  ) returning id into v_lead;

  insert into public.review_tasks (
    task_type, entity_table, entity_id, status, priority, notes,
    resolved_at, decided_by
  ) values (
    'source_new', 'discovery_leads', v_lead, 'dismissed', 100,
    'Discovery lead: Research Intern', now(), v_user
  );

  select public.record_discovery_feedback(
    v_lead, v_user, 'relevant',
    'Officer found this missed role through a manual search.',
    'missed_role', false, 1::smallint,
    '{
      "triage_score": 0,
      "triage_keep": 0,
      "student_bucket": 0,
      "official_route": 0,
      "linkedin_route": 1,
      "employer_search": 0,
      "historical_watch": 0,
      "scientific_lane_search": 0,
      "inverse_result_rank": 0,
      "repeat_observation": 0,
      "employer_identified": 1,
      "snippet_available": 0
    }'::jsonb,
    'officer_manual:linkedin_lead:all_lanes'
  ) into v_feedback;

  if not exists (
    select 1 from public.discovery_feedback
    where id = v_feedback and lead_id = v_lead and label = 'relevant'
      and label_source = 'missed_role'
  ) then
    raise exception 'missed-role feedback was not recorded';
  end if;
  if not exists (
    select 1 from public.discovery_leads
    where id = v_lead and officer_status = 'in_review'
  ) then
    raise exception 'a previously archived missed role was not reopened';
  end if;
  if not exists (
    select 1 from public.review_tasks
    where entity_table = 'discovery_leads' and entity_id = v_lead
      and status = 'in_progress' and assigned_to = v_user
      and resolved_at is null and decided_by is null
  ) then
    raise exception 'the dismissed review task was not reopened safely';
  end if;

  begin
    update public.discovery_feedback set reason = 'Tampered label history'
    where id = v_feedback;
    raise exception 'discovery feedback update was accepted';
  exception when others then
    if sqlerrm = 'discovery feedback update was accepted' then raise; end if;
  end;
end;
$$;

rollback;
