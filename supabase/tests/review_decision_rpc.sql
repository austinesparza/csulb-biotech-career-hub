\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_company uuid;
  v_source uuid;
  v_opportunity uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user,
    'authenticated', 'authenticated', 'review-rpc-test@example.edu', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.officers (user_id, display_name)
  values (v_user, 'Review RPC Test Officer');

  insert into public.companies (name, name_normalized, public_safe)
  values ('Review RPC Test Biotech', 'review rpc test biotech', false)
  returning id into v_company;
  insert into public.source_records (name, source_type, public_safe)
  values ('Review RPC Test Source', 'manual', false)
  returning id into v_source;
  insert into public.opportunities (
    company_id, source_record_id, title, posting_url,
    status, review_status, public_safe, audience_bucket, audience_reason,
    graduate_stage, dedupe_key, family_key
  ) values (
    v_company, v_source, 'Graduate Review RPC Intern', 'https://example.edu/jobs/review-rpc',
    'needs_review', 'pending', false, 'graduate', 'Posting explicitly accepts graduate students.',
    'graduate_unspecified',
    'review rpc test biotech|graduate review rpc intern|https://example.edu/jobs/review-rpc',
    'review rpc test biotech|graduate review rpc intern'
  ) returning id into v_opportunity;
  insert into public.review_tasks (task_type, entity_table, entity_id)
  values ('new_import', 'opportunities', v_opportunity);

  perform public.decide_opportunity_review(
    v_opportunity, v_user, 'approve', 'open_verified', '', true,
    'graduate', 'Posting explicitly accepts graduate students.',
    'graduate_unspecified', '{}'::jsonb, true, true
  );

  if not exists (
    select 1 from public.opportunities
    where id = v_opportunity and status = 'open_verified'
      and review_status = 'approved' and public_safe
  ) then
    raise exception 'review RPC did not publish the approved opportunity';
  end if;
  if not exists (
    select 1 from public.review_tasks
    where entity_table = 'opportunities' and entity_id = v_opportunity
      and status = 'done' and resolved_at is not null and decided_by = v_user
  ) then
    raise exception 'review RPC did not close the associated enum-status task';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.decide_opportunity_review(uuid,uuid,text,text,text,boolean,text,text,text,jsonb,boolean,boolean)',
    'EXECUTE'
  ) then
    raise exception 'review RPC is exposed to an authenticated browser role';
  end if;
end
$$;

rollback;
