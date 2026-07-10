-- CSULB Biotech Career Hub — initial schema (Deliverable E)
-- Apply via Supabase SQL editor or `supabase db push`.

create extension if not exists pg_trgm;

-- ============ ENUMS ============
create type source_type as enum ('spreadsheet','manual','student_submission','partner','website_page');
create type access_level as enum ('public','members','officers');
create type opportunity_status as enum (
  'open_verified','open_unverified','closed','expired','unknown',
  'archive_only','needs_review','broken_link','duplicate','not_relevant','hidden'
);
create type review_status as enum ('pending','approved','rejected','changes_requested');
create type paid_status as enum ('paid','unpaid','stipend','unknown');
create type person_role as enum ('mentor','alumnus','speaker','officer','other');
create type parse_status as enum ('ok','error','skipped');
create type import_run_status as enum ('running','completed','failed');
create type event_type as enum ('workshop','speaker_series','other');
create type resource_type as enum ('guide','template','link','recording','post');
create type task_type as enum ('new_import','possible_duplicate','possible_repost','broken_link','expiring','submission','consent_check','stale_record','import_changed');
create type task_status as enum ('open','in_progress','done','dismissed');
create type submission_type as enum ('opportunity','mentor_update','resource','correction');
create type submission_status as enum ('new','in_review','approved','rejected','spam');

-- ============ HELPERS ============
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ============ OFFICERS (auth allowlist) ============
create table officers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function is_officer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from officers where user_id = auth.uid() and is_active)
$$;

-- ============ TABLES ============
create table source_records (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type source_type not null,
  url text,
  owner text,                          -- who maintains this source
  access_level access_level not null default 'officers',
  canonical_status text,               -- e.g. 'primary spreadsheet', 'superseded'
  refresh_policy text,                 -- human-readable; e.g. 'manual re-export monthly; automated access not permitted'
  last_imported_at timestamptz,
  last_reviewed_at timestamptz,
  public_safe boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table import_runs (
  id uuid primary key default gen_random_uuid(),
  -- provenance is mandatory for imports: enforced NOT NULL here AND in app code
  source_record_id uuid not null references source_records(id),
  filename text not null,
  uploaded_by uuid references auth.users(id),
  status import_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total_rows int not null default 0,
  inserted_count int not null default 0,
  updated_count int not null default 0,
  duplicate_count int not null default 0,
  error_count int not null default 0,
  notes text
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text not null unique,
  website text,
  location text,
  industry_tags text[] not null default '{}',
  description text,
  notes_private text,
  public_safe boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  -- nullable only for legacy/manual rows; the import flow always sets it
  source_record_id uuid references source_records(id),
  title text not null,
  posting_url text,
  location text,
  eligibility text,
  focus_area text,
  deadline date,
  deadline_text text,                  -- original value ('Rolling', 'ASAP', ...)
  start_date_text text,                -- start date / duration as written
  paid_status paid_status not null default 'unknown',
  application_type text,
  source_status_raw text,              -- Status column as imported
  status opportunity_status not null default 'needs_review',
  public_notes text,
  private_notes text,
  date_added date,                     -- from spreadsheet
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_at timestamptz,
  relevance_score int,
  relevance_reasons text[] not null default '{}',
  review_status review_status not null default 'pending',
  public_safe boolean not null default false,
  dedupe_key text,                     -- strict: company|full title|url — automatic updates allowed
  family_key text,                     -- season/year-stripped — repost flagging ONLY
  duplicate_of uuid references opportunities(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_opportunities_dedupe on opportunities(dedupe_key);
create index idx_opportunities_family on opportunities(family_key);
create index idx_opportunities_board on opportunities(status, review_status, public_safe);
create index idx_opportunities_company on opportunities(company_id);
create index idx_opportunities_title_trgm on opportunities using gin (title gin_trgm_ops);
create index idx_companies_name_trgm on companies using gin (name_normalized gin_trgm_ops);

create table raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references import_runs(id) on delete cascade,
  row_number int not null,
  raw jsonb not null,
  parse_status parse_status not null default 'ok',
  error_message text,
  matched_opportunity_id uuid references opportunities(id),
  created_at timestamptz not null default now()
);
create index idx_raw_rows_run on raw_import_rows(import_run_id);

create table people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role_types person_role[] not null default '{}',
  email text,
  linkedin_url text,
  affiliation text,
  title text,
  bio text,
  photo_url text,
  contact_public boolean not null default false,   -- email/linkedin visible only if true
  consent_on_file boolean not null default false,
  consent_date date,
  consent_notes text,
  public_safe boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mentorship_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  focus_areas text[] not null default '{}',
  availability text,
  meeting_format text,
  ask_me_about text,
  accepting_mentees boolean not null default false,
  public_safe boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type event_type not null default 'other',
  event_date date,
  speaker_person_id uuid references people(id),
  description text,
  recording_url text,
  slides_url text,
  public_safe boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table career_paths (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  typical_roles text[] not null default '{}',
  education_notes text,
  sort_order int not null default 0,
  public_safe boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table resources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  resource_type resource_type not null default 'link',
  url text,
  description text,
  career_path_id uuid references career_paths(id),
  tags text[] not null default '{}',
  public_safe boolean not null default false,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table review_tasks (
  id uuid primary key default gen_random_uuid(),
  task_type task_type not null,
  entity_table text not null,
  entity_id uuid not null,
  status task_status not null default 'open',
  assigned_to uuid references auth.users(id),
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index idx_review_tasks_open on review_tasks(status) where status = 'open';

create table user_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type submission_type not null,
  payload jsonb not null,
  submitter_name text,
  submitter_email text,
  status submission_status not null default 'new',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_opportunity_id uuid references opportunities(id),
  notes text,
  created_at timestamptz not null default now()
);

create table semester_reports (
  id uuid primary key default gen_random_uuid(),
  semester_label text not null,
  starts_on date not null,
  ends_on date not null,
  stats jsonb not null default '{}',
  narrative text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

-- updated_at triggers
do $$ declare t text;
begin
  foreach t in array array['source_records','companies','opportunities','people',
    'mentorship_profiles','events','career_paths','resources'] loop
    execute format('create trigger trg_%s_updated before update on %I
      for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ============ ROW LEVEL SECURITY ============
-- Base tables: officers only. Public access goes through views below.
do $$ declare t text;
begin
  foreach t in array array['officers','source_records','import_runs','raw_import_rows',
    'companies','opportunities','people','mentorship_profiles','events','career_paths',
    'resources','review_tasks','user_submissions','semester_reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy officer_all_%s on %I for all
      using (is_officer()) with check (is_officer())', t, t);
  end loop;
end $$;

-- Public submit form: anon may INSERT submissions only (never read).
create policy anon_insert_submissions on user_submissions
  for insert to anon with check (true);

-- ============ PUBLIC VIEWS ============
-- Owned by postgres => bypass RLS by design; they are the ONLY thing anon can read.
-- They intentionally exclude all private columns.

create view public_opportunities as
select o.id, c.name as company_name, o.title, o.posting_url, o.location,
       o.eligibility, o.focus_area, o.deadline, o.deadline_text, o.start_date_text,
       o.paid_status, o.application_type, o.status, o.public_notes,
       o.relevance_score, o.last_checked_at, o.first_seen_at,
       s.name as source_name
from opportunities o
join companies c on c.id = o.company_id
left join source_records s on s.id = o.source_record_id and s.public_safe
where o.public_safe and o.review_status = 'approved'
  and o.status in ('open_verified','open_unverified');

create view public_companies as
select c.id, c.name, c.website, c.location, c.industry_tags, c.description,
       (select count(*) from opportunities o
         where o.company_id = c.id and o.public_safe and o.review_status = 'approved'
           and o.status in ('open_verified','open_unverified')) as open_count
from companies c
where c.public_safe;

create view public_mentors as
select p.id, p.full_name, p.affiliation, p.title, p.bio, p.photo_url,
       case when p.contact_public then p.email end as email,
       case when p.contact_public then p.linkedin_url end as linkedin_url,
       m.focus_areas, m.availability, m.meeting_format, m.ask_me_about, m.accepting_mentees
from people p
join mentorship_profiles m on m.person_id = p.id
where p.public_safe and m.public_safe and p.consent_on_file and 'mentor' = any(p.role_types);

create view public_alumni as
select p.id, p.full_name, p.affiliation, p.title, p.bio, p.photo_url,
       case when p.contact_public then p.linkedin_url end as linkedin_url
from people p
where p.public_safe and p.consent_on_file and 'alumnus' = any(p.role_types);

create view public_events as
select e.id, e.title, e.event_type, e.event_date, e.description,
       e.recording_url, e.slides_url,
       case when p.public_safe and p.consent_on_file then p.full_name end as speaker_name
from events e
left join people p on p.id = e.speaker_person_id
where e.public_safe;

create view public_resources as
select id, title, resource_type, url, description, career_path_id, tags, last_reviewed_at
from resources where public_safe;

create view public_career_paths as
select id, name, slug, description, typical_roles, education_notes, sort_order
from career_paths where public_safe;

-- Lock down: anon/authenticated read views only.
revoke all on all tables in schema public from anon;
grant select on public_opportunities, public_companies, public_mentors,
  public_alumni, public_events, public_resources, public_career_paths to anon, authenticated;
grant insert on user_submissions to anon;
grant all on all tables in schema public to service_role;
