-- =============================================================================
-- RLS baseline. Deny by default; grant narrowly.
--
-- Adapt table names to your schema. The important properties, in order:
--   1. RLS is ON for every table in `public`, enforced by a test (see 2.).
--   2. anon can INSERT submissions and can never SELECT them.
--   3. Officer reads go through auth.uid(), never through a shared key.
--   4. service_role bypasses RLS by design -- so that key must never leave
--      a server-side environment. checked by scripts/check-bundle-secrets.mjs.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Who is an officer
-- ---------------------------------------------------------------------------
create table if not exists public.officers (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  role        text not null default 'officer' check (role in ('officer','admin')),
  active      boolean not null default true,
  added_at    timestamptz not null default now(),
  removed_at  timestamptz
);

-- SECURITY DEFINER so the policy can read `officers` without recursing into
-- its own RLS policy. search_path is pinned to defeat search-path hijacking.
create or replace function public.is_active_officer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.officers
    where user_id = auth.uid() and active
  );
$$;

revoke all on function public.is_active_officer() from public, anon;
grant execute on function public.is_active_officer() to authenticated;

-- ---------------------------------------------------------------------------
-- Public submissions: write-only for the world
-- ---------------------------------------------------------------------------
create table if not exists public.submissions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  employer          text not null,
  role_title        text not null,
  url               text not null,
  notes             text,
  -- optional, personal, never rendered publicly and never sent to a model
  submitter_name    text,
  submitter_email   text,
  review_status     text not null default 'pending'
                    check (review_status in ('pending','accepted','rejected','duplicate')),
  reviewed_by       uuid references public.officers(user_id),
  reviewed_at       timestamptz,
  source_ip_hash    text  -- salted hash for rate limiting; never the raw IP
);

alter table public.submissions enable row level security;
alter table public.submissions force row level security;

drop policy if exists submissions_anon_insert on public.submissions;
create policy submissions_anon_insert
  on public.submissions for insert to anon, authenticated
  with check (
    review_status = 'pending'          -- nobody self-approves
    and reviewed_by is null
    and length(employer) between 1 and 200
    and length(role_title) between 1 and 300
    and url ~ '^https?://'
  );

-- No SELECT policy for anon. Absence of a policy under RLS = denied.
drop policy if exists submissions_officer_select on public.submissions;
create policy submissions_officer_select
  on public.submissions for select to authenticated
  using (public.is_active_officer());

drop policy if exists submissions_officer_update on public.submissions;
create policy submissions_officer_update
  on public.submissions for update to authenticated
  using (public.is_active_officer())
  with check (public.is_active_officer());

-- ---------------------------------------------------------------------------
-- Ingested drafts: officers only. The worker writes with service_role.
-- ---------------------------------------------------------------------------
create table if not exists public.opportunity_drafts (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  source_type       text not null,           -- greenhouse | ashby | lever | usajobs | page | submission
  source_url        text not null,
  external_id       text,
  employer          text not null,
  role_title        text not null,
  raw_text          text not null,           -- the fetched text extraction ran against
  raw_sha256        text not null,
  extracted         jsonb not null default '{}'::jsonb,
  evidence          jsonb not null default '{}'::jsonb,  -- field -> {quote, start, end}
  evidence_ok       boolean not null default false,
  graduate_stage    text check (graduate_stage in
                      ('msc_year1','msc_year2','msc_any','phd','postbac','undergrad_only','unclear')),
  review_status     text not null default 'pending'
                    check (review_status in ('pending','approved','rejected')),
  unique (source_type, external_id)
);

alter table public.opportunity_drafts enable row level security;
alter table public.opportunity_drafts force row level security;

drop policy if exists drafts_officer_all on public.opportunity_drafts;
create policy drafts_officer_all
  on public.opportunity_drafts for all to authenticated
  using (public.is_active_officer())
  with check (public.is_active_officer());

-- ---------------------------------------------------------------------------
-- Fetch log: how change detection avoids refetching unchanged pages
-- ---------------------------------------------------------------------------
create table if not exists public.source_fetches (
  id             bigserial primary key,
  url            text not null,
  fetched_at     timestamptz not null default now(),
  http_status    int,
  etag           text,
  last_modified  text,
  content_sha256 text,
  bytes          int,
  error          text
);
create index if not exists source_fetches_url_idx on public.source_fetches (url, fetched_at desc);

alter table public.source_fetches enable row level security;
alter table public.source_fetches force row level security;

drop policy if exists fetches_officer_select on public.source_fetches;
create policy fetches_officer_select
  on public.source_fetches for select to authenticated
  using (public.is_active_officer());

-- ---------------------------------------------------------------------------
-- Officers table protects itself. Only admins can change membership.
-- ---------------------------------------------------------------------------
alter table public.officers enable row level security;
alter table public.officers force row level security;

drop policy if exists officers_self_select on public.officers;
create policy officers_self_select
  on public.officers for select to authenticated
  using (user_id = auth.uid() or public.is_active_officer());

-- Membership changes happen with service_role from an admin-only path,
-- so no INSERT/UPDATE/DELETE policy is granted to authenticated at all.

-- ---------------------------------------------------------------------------
-- Belt and braces: RLS on for every current table in public.
-- Run this after adding tables; the CI test asserts it stayed true.
-- ---------------------------------------------------------------------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
  end loop;
end $$;
