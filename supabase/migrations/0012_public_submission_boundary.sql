-- Replace unrestricted anonymous table inserts with one validated, bounded
-- server-side capability. The application invokes this RPC with a server-only
-- credential; anon and authenticated clients cannot call it directly.

drop policy if exists anon_insert_submissions on public.user_submissions;
revoke insert on public.user_submissions from anon, authenticated;

create table if not exists public.public_submission_daily_limit (
  window_date date primary key,
  accepted_count integer not null default 0 check (accepted_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.public_submission_daily_limit enable row level security;
revoke all on public.public_submission_daily_limit from public, anon, authenticated;
grant select, insert, update, delete on public.public_submission_daily_limit to service_role;

create or replace function public.accept_public_submission(
  p_submission_type text,
  p_payload jsonb,
  p_submitter_name text default null,
  p_submitter_email text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_count integer;
  v_url text := trim(coalesce(p_payload->>'url', ''));
  v_company text := nullif(trim(coalesce(p_payload->>'company', '')), '');
  v_title text := nullif(trim(coalesce(p_payload->>'title', '')), '');
  v_details text := nullif(trim(coalesce(p_payload->>'details', '')), '');
begin
  if p_submission_type not in ('opportunity', 'correction', 'resource') then
    raise exception 'invalid submission type';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'submission payload must be an object';
  end if;
  if length(v_url) > 500 or v_url !~ '^https://[^[:space:]]+$' then
    raise exception 'a valid HTTPS URL is required';
  end if;
  if length(coalesce(v_company, '')) > 120
     or length(coalesce(v_title, '')) > 160
     or length(coalesce(v_details, '')) > 1000
     or length(coalesce(trim(p_submitter_name), '')) > 80
     or length(coalesce(trim(p_submitter_email), '')) > 120 then
    raise exception 'submission field is too long';
  end if;
  if p_submitter_email is not null
     and trim(p_submitter_email) <> ''
     and trim(p_submitter_email) !~ '^[^[:space:]@,<>]+@[^[:space:]@,<>]+\.[^[:space:]@,<>]+$' then
    raise exception 'invalid submitter email';
  end if;

  -- An identical pending URL is idempotent for 24 hours and does not consume
  -- another slot. This absorbs retries and the cheapest form of spam.
  select id into v_id
  from public.user_submissions
  where submission_type = p_submission_type::public.submission_type
    and payload->>'url' = v_url
    and status in ('new', 'in_review')
    and created_at >= now() - interval '24 hours'
  order by created_at desc
  limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.public_submission_daily_limit(window_date, accepted_count)
  values (current_date, 1)
  on conflict (window_date) do update
    set accepted_count = public.public_submission_daily_limit.accepted_count + 1,
        updated_at = now()
  returning accepted_count into v_count;

  if v_count > 200 then
    raise exception 'daily submission limit reached';
  end if;

  insert into public.user_submissions(
    submission_type, payload, submitter_name, submitter_email
  ) values (
    p_submission_type::public.submission_type,
    jsonb_build_object(
      'url', v_url,
      'company', v_company,
      'title', v_title,
      'details', v_details
    ),
    nullif(trim(coalesce(p_submitter_name, '')), ''),
    nullif(trim(coalesce(p_submitter_email, '')), '')
  ) returning id into v_id;

  delete from public.public_submission_daily_limit
  where window_date < current_date - 31;

  return v_id;
end;
$$;

revoke execute on function public.accept_public_submission(text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.accept_public_submission(text, jsonb, text, text)
  to service_role;

comment on function public.accept_public_submission(text, jsonb, text, text) is
  'Validated, globally bounded public intake. Creates private review records only; never publishes.';
