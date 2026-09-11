\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_company uuid;
  v_source uuid;
  v_opportunity uuid;
  v_updated_at timestamptz;
  v_first_revision uuid;
  v_unpublish_revision uuid;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user,
    'authenticated', 'authenticated', 'correction-test@example.edu', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );
  insert into public.officers (user_id, display_name)
  values (v_user, 'Correction Test Officer');

  insert into public.companies (name, name_normalized, public_safe)
  values ('Correction Test Biotech', 'correction test biotech', true)
  returning id into v_company;
  insert into public.source_records (name, source_type, public_safe)
  values ('Correction Test Source', 'manual', true)
  returning id into v_source;
  insert into public.opportunities (
    company_id, source_record_id, title, posting_url, location,
    status, review_status, public_safe, audience_bucket, audience_reason,
    graduate_stage, eligibility_status, dedupe_key, family_key, last_checked_at
  ) values (
    v_company, v_source, 'Original Graduate Intern', 'https://example.edu/jobs/original', 'Long Beach, CA',
    'open_verified', 'approved', true, 'graduate', 'Posting names graduate students.',
    'graduate_unspecified', 'confirmed',
    'correction test biotech|original graduate intern|https://example.edu/jobs/original',
    'correction test biotech|original graduate intern', now()
  ) returning id, updated_at into v_opportunity, v_updated_at;

  select public.revise_published_opportunity(
    v_opportunity, v_user, v_updated_at, 'correction',
    'Corrected the title from the official source.',
    '{"title":"Corrected Graduate Intern","dedupe_key":"correction test biotech|corrected graduate intern|https://example.edu/jobs/original","family_key":"correction test biotech|corrected graduate intern"}'::jsonb,
    true, true, null
  ) into v_first_revision;

  if not exists (
    select 1 from public.opportunities
    where id = v_opportunity and title = 'Corrected Graduate Intern' and public_safe
  ) then
    raise exception 'correction did not update the canonical public record';
  end if;
  if not exists (
    select 1 from public.opportunity_revisions
    where id = v_first_revision and revision_number = 1
      and before_snapshot->>'title' = 'Original Graduate Intern'
      and after_snapshot->>'title' = 'Corrected Graduate Intern'
  ) then
    raise exception 'correction history did not preserve before and after state';
  end if;

  begin
    perform public.revise_published_opportunity(
      v_opportunity, v_user, v_updated_at - interval '1 microsecond', 'correction',
      'Attempted a stale concurrent correction.', '{"title":"Stale title"}'::jsonb,
      true, true, null
    );
    raise exception 'stale correction was accepted';
  exception when others then
    if sqlerrm = 'stale correction was accepted' then raise; end if;
  end;

  select updated_at into v_updated_at from public.opportunities where id = v_opportunity;
  select public.revise_published_opportunity(
    v_opportunity, v_user, v_updated_at, 'unpublish',
    'Removed while the employer corrects the posting.', '{}'::jsonb,
    false, false, null
  ) into v_unpublish_revision;

  if not exists (
    select 1 from public.opportunities
    where id = v_opportunity and status = 'hidden' and not public_safe
  ) then
    raise exception 'unpublish did not remove the record from the public boundary';
  end if;

  select updated_at into v_updated_at from public.opportunities where id = v_opportunity;
  perform public.revise_published_opportunity(
    v_opportunity, v_user, v_updated_at, 'restore',
    'Restored after confirming the employer correction.', '{}'::jsonb,
    true, true, v_unpublish_revision
  );

  if not exists (
    select 1 from public.opportunities
    where id = v_opportunity and status = 'open_verified' and public_safe
  ) or (select count(*) from public.opportunity_revisions where opportunity_id = v_opportunity) <> 3 then
    raise exception 'restore did not republish and append a third revision';
  end if;

  begin
    update public.opportunity_revisions set reason = 'Tampered history'
    where id = v_first_revision;
    raise exception 'revision history update was accepted';
  exception when others then
    if sqlerrm = 'revision history update was accepted' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.revise_published_opportunity(uuid,uuid,timestamptz,text,text,jsonb,boolean,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.revise_published_opportunity(uuid,uuid,timestamptz,text,text,jsonb,boolean,boolean,uuid)', 'EXECUTE') then
    raise exception 'published correction RPC is exposed to a browser role';
  end if;
  if not has_function_privilege('service_role', 'public.revise_published_opportunity(uuid,uuid,timestamptz,text,text,jsonb,boolean,boolean,uuid)', 'EXECUTE') then
    raise exception 'service role cannot execute published correction RPC';
  end if;
end
$$;

rollback;
