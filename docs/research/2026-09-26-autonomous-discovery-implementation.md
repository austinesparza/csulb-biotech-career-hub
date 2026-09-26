# Autonomous search and source research

## What now runs in the existing daily pipeline

When `DISCOVERY_SEARCH_ENABLED=true` and the search provider is configured, the daily `/api/cron/ingest` cycle performs three bounded search passes after the approved source connectors finish:

1. Rotate through five employers per day across the **complete** alumni inventory plus the historical watch. Search employer career pages, general web results, indexed ATS pages and indexed LinkedIn job/posts. The alumni inventory only prioritizes employers; it is not a source of job facts.
2. Search one scientific lane per day from `taxonomy/lanes.yaml`, including ATS and indexed LinkedIn routes.
3. Rotate through up to three unresolved private `source_research` submissions per day. Search the exact employer and role title with two different query patterns. Attach an individual candidate employer/ATS URL only if the title strongly matches and the employer appears in the indexed result. Duplicate URL and recognizable requisition checks run against all opportunity statuses and `source_postings`, as well as other private research records. A match is linked for investigation, not created as a new opportunity.

The existing `job_sources` scheduler and connector fetchers are the scraping arm. They fetch only enabled sources with dated terms and robots reviews, archive private payload/version evidence, deduplicate posting identities, and enqueue material changes for officer review. Scrapling and ScrapeGraphAI are conditional fetch fallbacks on approved source pages. Search results do **not** authorize a new crawler target. An officer can register and review a new employer source through the pipeline controls before its feed is fetched automatically.

## Evidence boundary

Search results are stored in `discovery_leads` and immutable `discovery_lead_observations`. A recognizable Workday, Greenhouse or other ATS hostname is only an **indexed candidate**. The discovery worker sets `original_reachable=false`, `resolution=unresolved`, `canonical_employer_url=null`, and `raw_metadata.evidenceLevel=search_index_only`. It records the candidate URL separately for officer investigation. No status, Apply state, deadline, degree rule, or master's eligibility is inferred from the snippet. LinkedIn remains a private discovery surface.

The `20260926120000_discovery_review_candidate_gate.sql` migration makes routine observations archive-only. A new `source_new` review task is created only for a newly discovered, distinct exact-role candidate attached to source research. Existing officer-verified source resolution cannot be downgraded by a later search observation. This migration **must be applied before enabling discovery** so the broad query rotation does not create a task for every search result.

Officer flow: open `/admin/review?tab=submissions`, inspect the candidate requisition, confirm employer ownership, Apply, term, degree, enrollment and authorization, then create a private draft if distinct. Separately approve and publish only after source verification. Search never writes to public opportunities. The source research row records `posting_status=unknown` and `msc_eligibility=unknown` until reviewed. A candidate that matches a prior source posting or opportunity remains linked as an existing record, with no new review task.

## Operations and activation

The search adapter uses Brave's fixed API endpoint and a serial 1.1-second spacing between requests to respect the documented per-second rate window. It requires `BRAVE_SEARCH_API_KEY` and an explicit `BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED=true`. The flag must reflect the actual subscription terms for retained URLs/snippets; do not set it by assumption. Keep the key server-side. Set `DISCOVERY_SEARCH_ENABLED=true` only after migration and a bounded manual run (`npm run discovery:worker`) have succeeded. `EMPLOYER_DISCOVERY_BATCH_SIZE` (1–5), `LANE_DISCOVERY_BATCH_SIZE` (1–2), `SOURCE_RESEARCH_DISCOVERY_BATCH_SIZE` (1–5), and `EMPLOYER_DISCOVERY_RESULTS_PER_QUERY` (1–10) bound cost. The existing daily Vercel cron is sufficient; no additional scheduled endpoint is needed.

Check `pipeline_cycles.discovery_json` for employers, lanes, source research searched, candidate URLs, existing matches, query/results/archive totals, and errors. An error or disabled result is not a successful search. Watch provider 429s, indexed-only candidates that cannot be opened, the share of discovered roles already present, task load, and the 17 originally unresolved screenshot records. Recheck fresh officer-verified Apply and gates before any public open claim. If the provider is disabled, approved ATS feed ingestion continues independently.

## Next coverage work

- Add reviewed connectors for high-yield employer tenants and federal/program APIs. The current source registry controls what may be fetched, so a search hit on an unreviewed site remains research.
- Benchmark exact-role retrieval on the September screenshot catalog and weekly missed-role samples. Measure distinct role recall, employer URL precision, correct requisition identity, gate accuracy, and days from employer posting to officer review. Expand the title aliases and ATS detail-path rules based on misses, especially generic J&J Technology Co-Op siblings and institutional research programs.
- Add a first-party page snapshot verifier for approved tenant-specific hosts. It must store fetched text, redirect chain, timestamp, page hash and verbatim gate evidence; handle script-rendered portals as unknown. Do not call an indexed result verified just because an HTTP request returned 200.
- Build officer prioritization for the archived broad-search results after measuring volume. The bounded exact-role task route deliberately protects the task queue from hundreds of weak index hits.

Brave rate behavior and response headers: https://api-dashboard.search.brave.com/documentation/guides/rate-limiting . The project source governance and migration requirements are documented in `docs/15-operational-pipeline.md` and `supabase/migrations/0003_automated_ingestion_schema.sql`.
