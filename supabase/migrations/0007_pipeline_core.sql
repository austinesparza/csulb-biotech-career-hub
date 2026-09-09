-- =============================================================================
-- Pipeline schema. Supabase stays the source of truth; GitHub holds code,
-- prompts, taxonomy and evals; the Google Sheet (if used) is a sanitized mirror.
--
-- Design decisions worth knowing:
--   * `sources` carries its own schedule, driven by the recruiting calendar you
--     already maintain. Poll NIH daily in its window, monthly otherwise.
--   * `source_fetches` makes change detection cheap: conditional GET + hash.
--     Most weeks return 304 and cost nothing.
--   * `raw_documents` stores the text extraction ran against. Without it,
--     evidence quotes cannot be verified later and provenance is a claim.
--   * Extraction NEVER writes to the published table. It writes drafts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- What we watch, and how often
-- ---------------------------------------------------------------------------
create type source_kind as enum ('greenhouse','ashby','lever','smartrecruiters','workable','usajobs','page','submission');

create table if not exists public.sources (
  id                uuid primary key default gen_random_uuid(),
  kind              source_kind not null,
  employer          text not null,
  -- board token for ATS sources; full URL for 'page'
  identifier        text not null,
  active            boolean not null default true,
  -- Cadence comes from the recruiting calendar. Inside a known window we poll
  -- often; outside it we barely poll at all. This is the calendar doing work
  -- rather than just being displayed.
  window_start      date,
  window_end        date,
  poll_in_window    interval not null default '1 day',
  poll_out_window   interval not null default '30 days',
  last_polled_at    timestamptz,
  consecutive_errors int not null default 0,
  last_error        text,
  notes             text,
  unique (kind, identifier)
);

create or replace function public.sources_due(at timestamptz default now())
returns setof public.sources
language sql stable as $$
  select * from public.sources
  where active
    and consecutive_errors < 5           -- circuit breaker; officers reset it
    and (
      last_polled_at is null
      or last_polled_at < at - (
        case
          when window_start is not null
           and at::date between window_start and window_end
          then poll_in_window
          else poll_out_window
        end
      )
    )
  order by last_polled_at nulls first
  limit 25;                              -- politeness: bounded batch
$$;

-- ---------------------------------------------------------------------------
-- Fetch log: conditional GET state, so unchanged pages cost one 304
-- ---------------------------------------------------------------------------
create table if not exists public.source_fetches (
  id             bigserial primary key,
  source_id      uuid references public.sources(id) on delete cascade,
  url            text not null,
  fetched_at     timestamptz not null default now(),
  http_status    int,
  etag           text,
  last_modified  text,
  content_sha256 text,
  bytes          int,
  changed        boolean not null default false,
  error          text
);
create index if not exists source_fetches_recent on public.source_fetches (source_id, fetched_at desc);

-- ---------------------------------------------------------------------------
-- Raw text. Evidence quotes are verified against THIS, so it must be immutable.
-- ---------------------------------------------------------------------------
create table if not exists public.raw_documents (
  id            uuid primary key default gen_random_uuid(),
  source_id     uuid references public.sources(id) on delete set null,
  url           text not null,
  fetched_at    timestamptz not null default now(),
  content_sha256 text not null,
  raw_text      text not null,
  unique (content_sha256)
);

-- ---------------------------------------------------------------------------
-- Classification output (deterministic, pre-model). Cheap to recompute when the
-- taxonomy version changes -- which is why taxonomy_version is stored.
-- ---------------------------------------------------------------------------
create table if not exists public.candidates (
  id                uuid primary key default gen_random_uuid(),
  raw_document_id   uuid not null references public.raw_documents(id) on delete cascade,
  source_id         uuid references public.sources(id) on delete set null,
  external_id       text,
  employer          text not null,
  title             text not null,
  url               text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  closed_at         timestamptz,                    -- set when it disappears from the source
  taxonomy_version  int not null,
  kept              boolean not null,
  drop_reason       text,
  lanes             jsonb not null default '[]'::jsonb,
  functions         jsonb not null default '[]'::jsonb,
  methods           jsonb not null default '{}'::jsonb,
  opportunity_type  jsonb,
  graduate_stage    text,
  structural_gate   jsonb,
  personal_gates    text[] not null default '{}',
  suggested_bucket  text check (suggested_bucket in ('graduate','special','adjacent','excluded')),
  score             numeric,
  unique (source_id, external_id)
);
create index if not exists candidates_open on public.candidates (kept, closed_at, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- Extraction output. `evidence_ok` is set by lib/evidence.ts, not by the model.
-- ---------------------------------------------------------------------------
create table if not exists public.extractions (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  created_at       timestamptz not null default now(),
  model            text not null,
  prompt_version   text not null,
  schema_version   int not null,
  fields           jsonb not null,        -- field -> {value, quote}
  bindings         jsonb not null,        -- field -> {start, end, ok, reason}
  evidence_ok      boolean not null,
  binding_failures text[] not null default '{}',
  injection_flags  text[] not null default '{}',
  input_tokens     int,
  output_tokens    int,
  trace_id         text                    -- Langfuse trace, for later forensics
);
create index if not exists extractions_candidate on public.extractions (candidate_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The officer inbox. THE missing piece in the current system.
-- ---------------------------------------------------------------------------
create type review_state as enum ('pending','approved','rejected','needs_info','duplicate');

create table if not exists public.review_queue (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references public.candidates(id) on delete cascade,
  extraction_id  uuid references public.extractions(id) on delete set null,
  submission_id  uuid,                    -- when the origin was a public submission
  queued_at      timestamptz not null default now(),
  priority       int not null default 100,-- lower = sooner; deadline proximity drives this
  state          review_state not null default 'pending',
  assigned_to    uuid,
  decided_by     uuid,
  decided_at     timestamptz,
  officer_notes  text,
  -- What the officer actually publishes; starts as a copy of the extraction and
  -- is edited by hand. The published record comes from HERE, never from `extractions`.
  final_fields   jsonb,
  final_bucket   text check (final_bucket in ('graduate','special','adjacent','excluded')),
  final_reason   text,
  unique (candidate_id)
);
create index if not exists review_queue_open on public.review_queue (state, priority, queued_at);

-- ---------------------------------------------------------------------------
-- Published records: what the public exporter reads.
-- ---------------------------------------------------------------------------
create table if not exists public.published_opportunities (
  id               uuid primary key default gen_random_uuid(),
  review_id        uuid not null references public.review_queue(id),
  published_at     timestamptz not null default now(),
  published_by     uuid not null,
  checked_on       date not null,
  employer         text not null,
  role_title       text not null,
  source_url       text not null,
  audience_bucket  text not null check (audience_bucket in ('graduate','special','adjacent','excluded')),
  audience_reason  text not null,
  fields           jsonb not null,
  evidence         jsonb not null,
  retired_at       timestamptz,
  retired_reason   text
);
create index if not exists published_live on public.published_opportunities (retired_at, audience_bucket);

-- ---------------------------------------------------------------------------
-- Drift detection. A parser that silently returns nothing is the failure mode
-- that quietly rots a pipeline.
-- ---------------------------------------------------------------------------
create or replace view public.source_health as
select
  s.id, s.employer, s.kind, s.last_polled_at, s.consecutive_errors,
  (select count(*) from public.candidates c where c.source_id = s.id and c.last_seen_at > now() - interval '30 days') as recent_candidates,
  (select count(*) from public.source_fetches f where f.source_id = s.id and f.error is not null and f.fetched_at > now() - interval '14 days') as recent_errors,
  (select avg(case when e.evidence_ok then 0 else 1 end)
     from public.extractions e join public.candidates c2 on c2.id = e.candidate_id
    where c2.source_id = s.id and e.created_at > now() - interval '30 days') as binding_failure_rate
from public.sources s
where s.active;

comment on view public.source_health is
  'Alert when: consecutive_errors >= 2, or recent_candidates = 0 for a source that previously returned some, or binding_failure_rate jumps. The last one catches a page redesign before it poisons the data.';

-- ---------------------------------------------------------------------------
-- Stale published records, for the weekly email.
-- ---------------------------------------------------------------------------
create or replace view public.stale_published as
select id, employer, role_title, source_url, checked_on,
       (current_date - checked_on) as days_since_check
from public.published_opportunities
where retired_at is null and checked_on < current_date - 14
order by checked_on;
