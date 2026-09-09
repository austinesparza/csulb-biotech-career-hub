-- Fetch-tier state. A source that needed a stronger fetcher last week starts
-- there this week, so the same failure never costs a second run.

alter table public.sources
  add column if not exists fetch_tier smallint not null default 0
    check (fetch_tier between 0 and 2),
  add column if not exists tier_clean_runs int not null default 0,
  add column if not exists tier_reason text,
  add column if not exists tier_changed_at timestamptz;

alter table public.source_fetches
  add column if not exists tier smallint,
  add column if not exists tier_attempts jsonb;

comment on column public.sources.fetch_tier is
  '0 conditional GET (free) · 1 Scrapling (JS + adaptive) · 2 ScrapeGraphAI (hosted). Escalates automatically on failure, demotes after 8 consecutive clean runs so cost decays.';

-- Paid-tier spend, for the budget guard and the weekly digest.
create or replace view public.fetch_tier_spend as
select
  date_trunc('month', fetched_at) as period,
  count(*) filter (where tier = 2) as paid_fetches,
  count(*) filter (where tier = 1) as scrapling_fetches,
  count(*) filter (where tier = 0) as free_fetches,
  round(count(*) filter (where tier = 2) * 0.01, 2) as estimated_cost_usd
from public.source_fetches
where fetched_at > now() - interval '6 months'
group by 1 order by 1 desc;

-- Sources currently costing money, so an officer can see drift as spend.
create or replace view public.escalated_sources as
select id, employer, kind, fetch_tier, tier_reason, tier_changed_at, tier_clean_runs,
       (8 - tier_clean_runs) as clean_runs_until_demotion
from public.sources
where active and fetch_tier > 0
order by fetch_tier desc, tier_changed_at desc;

comment on view public.escalated_sources is
  'Escalation is silent by design, but never invisible: this feeds the weekly digest so officers see which sources degraded without being interrupted at the time.';
