begin;

do $$
begin
  if has_table_privilege('anon', 'public.user_submissions', 'INSERT') then
    raise exception 'anon must not insert directly into user_submissions';
  end if;
  if has_function_privilege('anon', 'public.accept_public_submission(text,jsonb,text,text)', 'EXECUTE') then
    raise exception 'anon must not execute accept_public_submission';
  end if;
  if not has_function_privilege('service_role', 'public.accept_public_submission(text,jsonb,text,text)', 'EXECUTE') then
    raise exception 'service_role must execute accept_public_submission';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'public_opportunities'
      and column_name = 'graduate_stage'
  ) then
    raise exception 'public view must expose the reviewed graduate stage';
  end if;
end
$$;

set local role service_role;
select public.accept_public_submission(
  'opportunity',
  '{"url":"https://example.org/internship","company":"Example Bio","title":"Graduate Intern"}'::jsonb,
  null,
  'student@example.edu'
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.user_submissions
    where payload->>'url' = 'https://example.org/internship' and status = 'new'
  ) then
    raise exception 'validated service intake did not create a private submission';
  end if;
end
$$;

rollback;
