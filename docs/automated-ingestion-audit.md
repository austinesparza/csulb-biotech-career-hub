# CSULB Biotechnology Club Career Hub Automated Ingestion Audit and Specification

## Recommendation and repository audit

**1. Executive recommendation**

The strongest MVP is a **curated-source, connector-based ingestion system** that extends the existing manual-import architecture rather than replacing it. The system should use **approved official APIs and documented public feeds first**, beginning with **Greenhouse Job Board API**, **Lever public Postings API**, **Ashby public job-posting endpoints where public access is verified during onboarding**, plus **government and research-program sources such as USAJOBS, NIH, NSF REU, DOE SULI, NASA internships, and selected national-laboratory programs**. Each fetch should create a **source fetch run**, preserve **raw payload provenance**, normalize records into a **machine staging layer**, run **deterministic dedupe and relevance scoring**, and then create or update **nonpublic draft opportunities** and **review tasks**. No automated connector should publish directly to the student board. citeturn31view4turn32view0turn15search0turn16search0turn15search2turn20search0turn21search0turn20search5turn21search2turn22search0

For execution, the MVP should use **Supabase Cron + Supabase Edge Functions** rather than GitHub Actions or Vercel Cron as the main scheduler. Supabase Cron is database-local and designed to invoke database functions, Edge Functions, or webhooks; Vercel Hobby cron is restricted to once per day with hour-level precision, and GitHub Actions scheduled workflows in public repositories can auto-disable after 60 days of inactivity. Supabase Edge Functions also keep secrets close to the database and avoid preview-deployment ambiguity, though the worker must be batched because Edge Functions have finite duration limits. citeturn24search0turn24search12turn24search1turn24search14turn24search2turn25search0turn24search3

The **current repo is a very good foundation** because it already enforces the most important invariants: officer-gated review, RLS on base tables, public-safe views, provenance-aware import design, deterministic scoring, dedupe, and explicit protection against silently overwriting approved public records. The automated system should therefore **reuse** the existing `opportunities`, `companies`, `review_tasks`, `source_records`, public views, and officer auth model; **add** automated-source registry and fetch/versioning tables; and **route all material changes through the existing review workflow**. citeturn33view1turn31view4turn32view1turn14view3

The MVP should **defer** generalized internet scraping, JavaScript-rendered sites requiring browser automation, LinkedIn/Handshake/Indeed/Glassdoor as foundation sources, Workday/iCIMS/Taleo/ADP connectors, commercial aggregator APIs, and any LLM-dependent extraction pipeline. Those can be revisited later, but they are not the right first layer for a small student-run system whose priorities are defensibility, maintainability, and officer control. citeturn27search1turn27search4turn27search8turn27search2turn19search0turn19search5turn19search2turn19search27

**2. Current repository audit**

The repository already ships a narrow, coherent stack: **Next.js 15, React 19, TypeScript, Supabase SSR, Supabase JS, and PapaParse**, with CI running `typecheck` and `build` using dummy Supabase values so CI does not depend on a live project. Current validation also shows `npm run typecheck` and `npm run build` succeed today. The build still emits a **pre-existing Supabase Edge Runtime compatibility warning** because the middleware instantiates a Supabase SSR client, so this document should describe it only as an observed warning rather than a confirmed false positive. That is still the right baseline for an officer-maintainable student system. citeturn35view0turn12view0

The most reusable database objects are:

- `officers` plus `is_officer()` for authz.  
- `source_records` for human-readable provenance.  
- `import_runs` and `raw_import_rows` for manual CSV audit trails.  
- `companies` and `opportunities` as the curated publication layer.  
- `review_tasks` for human follow-up.  
- `public_opportunities` and `public_companies` as the public-safe read boundary.  
- RLS policies that restrict base tables to officers and expose only public views to anon users. citeturn30view0turn33view1

The most reusable application paths are:

- `src/lib/supabase/server.ts`, which exports the server-side auth helpers used by admin actions.  
- `src/middleware.ts`, which participates in the officer/auth boundary.  
- `src/app/admin/import/actions.ts`, together with `src/lib/csvImport.ts`, `src/lib/dedupe.ts`, and `src/lib/relevance.ts`, which already implement provenance-first import, deterministic normalization, dedupe, and scoring.  
- `src/app/admin/review/page.tsx`, `src/app/admin/review/actions.ts`, and `src/app/admin/review/review-list.tsx`, which implement the officer queue and guarded approval/rejection.  
- `src/app/internships/page.tsx` and the company directory, which already consume the public-safe views rather than base tables. citeturn31view4turn32view0turn32view1turn29view0turn11view0

The current dedupe and review architecture is **sufficient as a foundation**, but not sufficient by itself for multi-source automated ingestion. The important good news is that the repo already documents and implements the critical rule that **approved public listings cannot be silently altered by re-imports**. For URL or strict-key matches, public approved records update only `last_seen_at`; any material field difference creates an `import_changed` review task instead. That is the exact rule the automated system should preserve. citeturn31view4

The biggest gaps for automated ingestion are structural, not conceptual. The repo has a `source_type` enum with values including `website_page`, and `source_records` already includes `url`, `refresh_policy`, `last_imported_at`, and `last_reviewed_at`, which proves the schema anticipated web-originated data. But it does **not** yet have a machine-usable source registry, fetch scheduling state, per-source retries, raw payload storage for non-CSV data, posting-version history, or a queue model for connector execution. Those should be added as new tables rather than overloaded into the manual CSV tables. citeturn30view0

The public publication boundary is sound. Base tables are protected by RLS, while `public_opportunities` and `public_companies` expose only public-safe approved data, with explicit `where o.public_safe and o.review_status = 'approved' and o.status in ('open_verified','open_unverified')`. The student-facing internships page is explicitly documented as reading only the `public_opportunities` view. citeturn33view1turn29view0

The officer workflow is also sound. The review page calls `requireOfficer()`, loads only `status='needs_review'`, sorts by `relevance_score`, and reminds officers that nothing goes public until approved there. The review actions are server-only, re-check officer status before using the service client, and set `review_status='approved'` and `public_safe=true` only when an officer approves. citeturn32view0turn32view1

The current authorization boundary must be described precisely. The service-role client **bypasses RLS**. The middleware only verifies that a Supabase session exists for `/admin/*` requests, while `requireOfficer()` is the decisive officer-authorization boundary before any privileged service-role access. Those layers are complementary rather than redundant: removing `requireOfficer()` would be unsafe even if middleware and RLS remained, and scheduled jobs using the service role must continue to leave publication decisions to officer-reviewed paths. Production service-role credentials should remain **production-only**, and preview deployments should receive **no production service-role key**. CI already demonstrates the right spirit by using dummy env vars for build validation. citeturn32view1turn26search17turn12view0turn41view0

The migrations are **not idempotent in a rerun-safe sense**. `0001_init.sql` uses `create type`, `create table`, `create view`, and `create policy` broadly without `if not exists`; only extensions use `if not exists`. That is fine for one-time bootstrapping, but future schema work for automation should be split into additive migrations that are rerunnable where practical and never require the monolith to be re-executed. citeturn30view0turn33view1

The current codebase can support multiple automated source types cleanly **if** the implementation adds a dedicated automated-source layer beneath the current curated publication layer. The right reuse pattern is: keep `opportunities` as curated public content, keep `source_records` as the human-readable provenance object, and introduce machine-facing source/fetch/posting/version tables that feed the existing queue. That preserves the repo’s existing invariants instead of fighting them. citeturn30view0turn31view4

## Sources and registry

**3. Source strategy matrix**

| Source type | Official API availability | Authentication | Data quality | Implementation effort | Maintenance burden | Legal or policy risk | Recommendation |
|---|---|---:|---|---|---|---|---|
| Greenhouse Job Board API | Yes | None for GET job-board reads; Basic Auth only for application submission | High | Low | Low | Low if limited to public GET endpoints | **Accept for MVP**. Public GET endpoints are explicitly documented and designed for custom careers pages. citeturn15search0turn38search0 |
| Lever public Postings API | Yes, public postings API documented by official repo | Public-read behavior is documented via public endpoint examples; no credential step is shown in reviewed public materials | High | Low | Low | Low if limited to public postings | **Accept for MVP**. Use only public postings surfaces. citeturn16search0turn16search1 |
| Ashby public job-posting API | Yes | Public-job auth details are less clear in reviewed snippets; general Ashby API uses Basic Auth | High | Medium | Medium | Low to medium; onboarding must confirm public accessibility | **Accept with onboarding verification**. Implement only for boards verified public during source approval. citeturn15search2turn38search11turn38search5 |
| SmartRecruiters Posting API | Yes | API key or OAuth/partner auth | High | Medium | Medium | Medium; requires customer or partner credentials | **Defer**. Strong API, but not a no-credential public source suitable for a student club. citeturn18search0turn18search2turn18search8 |
| Workable official API | Yes | Bearer/API token from employer account | High | Medium | Medium | Medium; employer-admin token required | **Defer as foundational source**. Official API is not public-read in the reviewed docs. citeturn17search0turn17search4turn17search6 |
| Workday career sites | Official developer program exists, but no clearly documented public job-board extraction model was found in reviewed materials | Authenticated enterprise integrations | Variable | High | High | Medium | **Defer**. Use manual watchlist only for MVP. This is an inference from reviewed Workday developer materials and the absence of a documented public job-board API in the sources reviewed. citeturn19search0turn19search4 |
| iCIMS | Yes | Partner/customer access | High | High | High | Medium | **Defer**. Job Portal API exists for vendors/partners, not as a lightweight public club feed. citeturn19search13turn19search5turn19search17 |
| Taleo / Oracle Recruiting | Yes | Secure authenticated enterprise integration | Medium | High | High | Medium | **Defer**. Useful only with customer or partner access. citeturn19search2turn19search14 |
| ADP Recruiting | APIs exist | Developer/API Central access | Medium | High | High | Medium | **Defer**. Enterprise integration model, not public-read discovery. citeturn19search7turn19search11turn19search27 |
| Government job APIs | Yes | USAJOBS requires API key | High | Low | Low | Low | **Accept for MVP**. USAJOBS is especially strong for national-lab and federal internship discovery. citeturn20search0turn20search7turn20search11turn20search19 |
| NIH / NSF / DOE / NASA / national-lab program pages | Yes for some, structured official pages for many | Usually public | High | Low to Medium | Low to Medium | Low | **Accept for MVP**. These are official, student-oriented, and high relevance. citeturn21search0turn20search5turn21search2turn22search0turn21search5turn21search9turn21search13turn21search17turn21search21 |
| University / academic research listings | Often no API, but official pages exist | Usually public | Medium | Medium | Medium | Low | **Accept selectively**. Curate only official institutional pages or stable directories. citeturn20search3turn21search19 |
| RSS / XML / JSON / Schema.org JobPosting feeds | Yes, where publishers expose them | Usually public | Medium to High | Low to Medium | Low | Low | **Accept**. Prefer structured public feeds and schema.org over raw HTML parsing. citeturn23search1turn23search9turn23search12 |
| Static HTML career pages | No API, but parsable | Public | Medium | Medium | Medium | Low to Medium depending on robots/terms | **Accept case-by-case**. Require allowlisting, robots review, small request volume, and deterministic selectors. citeturn23search3turn23search15 |
| JavaScript-rendered career pages | Sometimes no stable public feed | Public page, but browser-rendering often required | Variable | High | High | Medium | **Defer for MVP**. Too brittle for officer-run maintenance. |
| Search-engine discovery APIs | Yes | API key | Low as a source of truth, useful for discovery | Low | Low | Low | **Use only for discovery and source onboarding**, not as the authoritative job feed. citeturn23search2turn23search10 |
| Commercial job-data APIs | Yes | Paid/vendor contract | Medium to High but provenance varies | Low integration effort, high vendor dependence | Medium | Medium | **Defer**. Avoid paid lock-in and provenance blur in MVP. |
| LinkedIn | Platform policies prohibit scraping/automation | Authenticated platform | High content value, low feasibility | High | High | High | **Exclude as foundational source**. LinkedIn explicitly disallows third-party scraping and automated activity. citeturn27search4turn27search8 |
| Handshake | Platform policies prohibit bulk scraping | Authenticated platform | High content value, low feasibility | High | High | High | **Exclude as foundational source**. Handshake terms explicitly prohibit bulk collection/scraping of job and marketplace information. citeturn27search1 |
| Indeed / Glassdoor | Exists as partner ecosystem, but not suitable public-source foundation | Vendor/partner model or user-facing site | Medium | High | High | High | **Exclude as foundational source**. Indeed restricts automation around its workflows; Glassdoor sits in the same legal/operator orbit after the merger and is not a good foundational dependency for a club-run board. citeturn27search2turn27search6turn27search3turn27search27 |

**4. Initial employer and program registry**

The initial registry should bias toward **official student programs**, **federal/research opportunities**, and **connector-friendly public ATS boards**. I recommend starting with **28 sources**: 14 program/public-institution sources and 14 employer/ATS sources. The first live implementation should onboard only **10 to 15** of these in the first pass, beginning with the lowest-effort and highest-relevance sources. citeturn20search0turn21search0turn22search0turn31view4

| Organization | Source type | ATS or platform | Verified URL | Geographic relevance | Likely student relevance | Priority | Complexity | Maintenance risk | Verification |
|---|---|---|---|---|---|---|---|---|---|
| USAJOBS | Government API | USAJOBS API | developer.usajobs.gov | National + remote + federal labs | Internships, recent grads, federal science roles | P0 | Low | Low | citeturn20search0turn20search19 |
| NIH Summer Internship Program | Official program page | NIH program site | training.nih.gov/research-training/pb/sip | National | Biomedical research internships | P0 | Low | Low | citeturn21search0 |
| NIH Academic Internship Program | Official program page | NIH program site | training.nih.gov/research-training/pb | National | Academic-year research opportunities | P1 | Low | Low | citeturn21search4 |
| NSF REU | Official program page | NSF / ETAP ecosystem | nsf.gov/funding/initiatives/reu | National | Undergraduate research | P0 | Low | Low | citeturn20search5turn20search18 |
| NSF ETAP | Official portal | ETAP | etap.nsf.gov | National | Undergraduate summer research and training opportunities | P1 | Medium | Medium | citeturn20search1turn20search16 |
| DOE Internships & Fellowships | Official program page | DOE / USAJOBS | energy.gov/internships-fellowships | National | Internships and fellowships | P0 | Low | Low | citeturn21search1 |
| DOE SULI | Official program page | DOE Office of Science | science.osti.gov/wdts/suli | National labs | Paid undergraduate laboratory research | P0 | Low | Low | citeturn21search2 |
| NASA Internship Programs | Official program page | NASA / OSTEM / Pathways | nasa.gov/learning-resources/internship-programs | National | Paid internships and pathways roles | P0 | Low | Low | citeturn22search0turn22search6 |
| NASA STEM Gateway | Official searchable portal | STEM Gateway | stemgateway.nasa.gov/s/explore-opportunities | National | Searchable internship opportunities | P0 | Medium | Low | citeturn22search1turn22search3 |
| JPL Internships | Official program page | JPL Academic Engagement | jpl.nasa.gov/edu/internships/apply | Southern California | STEM internships and research programs | P0 | Low | Low | citeturn22search11turn22search15 |
| Argonne National Laboratory | Official program page | ANL education site | anl.gov/education/undergraduate-internship-opportunities | National labs | Undergraduate research internships | P1 | Low | Low | citeturn21search5 |
| PNNL | Official program page | PNNL site | pnnl.gov/internships | National labs | Undergraduate internships | P1 | Low | Low | citeturn21search9 |
| Los Alamos National Laboratory | Official program page | LANL student programs | lanl.gov/engage/collaboration/student-programs/undergrad | National labs | Undergraduate research and technical internships | P1 | Low | Low | citeturn21search13 |
| Sandia National Laboratories | Official program page | Sandia careers | sandia.gov/careers/careers/students-and-postdocs/internships-co-ops | National labs | Student internships and co-ops | P1 | Low | Low | citeturn21search17 |
| Fermilab internships | Official program page | Fermilab internships | internships.fnal.gov | National labs | STEM internships and partner programs | P1 | Low | Low | citeturn21search21 |
| Pathways to Science | Structured opportunity directory | Official directory | pathwaystoscience.org/Discipline.aspx?sort=TEC-BioTech_Biotechnology | National | Biotech internships and REUs | P0 | Medium | Medium | citeturn21search14turn20search3 |
| Amgen | Employer careers | Custom careers site | careers.amgen.com/en/students-graduates | Southern California | Internships, co-ops, rotational programs | P1 | Medium | Medium | citeturn36search0turn36search16 |
| Gilead Sciences | Employer careers | Custom careers site | gilead.com/careers/opportunities/early-career-opportunities | California + remote | Entry-level, internships, rotational programs | P1 | Medium | Medium | citeturn36search1turn36search5 |
| Genentech | Employer careers | Custom careers site | careers.gene.com/us/en/c/students-graduates-jobs | California | Students & graduates roles | P1 | Medium | Medium | citeturn36search6turn36search2 |
| BioMarin | Employer careers | Custom careers site | biomarin.com/careers | California | Internships, fellowships, rotations | P1 | Medium | Medium | citeturn36search3turn36search7 |
| Illumina | Employer careers | Custom careers site | illumina.com/company/careers.html | San Diego | Genomics/life-science roles | P1 | Medium | Medium | citeturn37search0 |
| Thermo Fisher Scientific | Employer careers | Custom careers site | jobs.thermofisher.com/global/en/students-new-grads | California + remote | Student internships, leadership programs, early talent | P1 | Medium | Medium | citeturn37search5turn37search16 |
| Biogen | Employer careers | Custom careers site | biogen.com/careers/students-and-graduates.html | National | Internships and co-ops | P1 | Medium | Medium | citeturn37search2turn37search10 |
| Edwards Lifesciences | Employer careers | Custom careers site | edwards.com/careers | Orange County | University student & graduate programs | P1 | Medium | Medium | citeturn37search3turn37search7 |
| Zymo Research | Employer program page | Official internship page | zymoresearch.com/pages/biotechnology-paid-internships | Orange County | Paid biotech internships | P0 | Low | Low | citeturn21search18 |
| Takeda | Employer program page | Takeda jobs site | jobs.takeda.com/takeda-summer-internship-program | California + national | Summer internships | P1 | Medium | Medium | citeturn39search0turn39search14 |
| Agilent | Employer careers | Custom careers site | careers.agilent.com/locations/americas/united-states | California | Grad & student jobs | P1 | Medium | Medium | citeturn39search2turn39search6 |
| FUJIFILM Biotechnologies | Employer careers | Custom careers site | fujifilmdiosynth.com/careers | California + national | CDMO/manufacturing early-career roles | P2 | Medium | Medium | citeturn39search3 |
| Ultragenyx | Employer careers | Greenhouse | boards.greenhouse.io/ultragenyxpharmaceutical | Bay Area + remote-friendly patterns | Internships, co-ops, advanced degree programs | P0 | Low | Low | citeturn40search5 |
| Veracyte | Employer careers | Greenhouse | boards.greenhouse.io/veracyte | Southern California relevance through diagnostics sector | R&D laboratory intern roles | P0 | Low | Low | citeturn40search8 |
| Penumbra | Employer careers | Lever | jobs.lever.co/penumbrainc | California | Intern and clinical-research-adjacent roles | P0 | Low | Low | citeturn40search7turn40search10 |
| Fluxergy | Employer careers | Lever | jobs.lever.co/fluxergy-2 | San Diego | Engineering/science intern roles with biological applications | P0 | Low | Low | citeturn40search0 |

A note on the **alumni database**: it should **not** be treated as a discovery source for scraping or automated external job collection. It may eventually become an **enrichment and prioritization layer**, but that integration should be deferred until **after the ingestion MVP**. The right long-term use is to help officers decide which employers to onboard first and later display consent-aware “alumni worked here” enrichment—not to extract opportunities from LinkedIn. citeturn28view1turn10view3turn27search4turn27search8

## Architecture and data model

**5. Recommended architecture**

The recommended architecture is a **two-layer model**:

- **Machine observation layer**: fetches, payloads, source postings, versions, source health.
- **Curated publication layer**: existing `companies`, `opportunities`, `review_tasks`, public views.

That separation is the key reason the system can ingest automatically **without** silently changing public content. It mirrors the repo’s current CSV philosophy: raw rows are audited separately from curated board rows. citeturn31view4turn33view1

```text
Supabase Cron
   │
   ▼
scheduler Edge Function
   │ selects due enabled job_sources
   ▼
source_fetch_runs (pending → running)
   │
   ├── worker Edge Function batch 1 ──┐
   ├── worker Edge Function batch 2 ──┤ independent source execution
   └── worker Edge Function batch N ──┘
            │
            ▼
      connector interface
            │
            ├─ fetch official API / feed / approved HTML page
            ├─ store raw payload metadata + bytes
            ├─ normalize to intermediate posting objects
            ├─ upsert source_postings
            ├─ insert source_posting_versions on material change
            ├─ run deterministic dedupe + scoring
            └─ create/update opportunities + review_tasks
                         │
                         ▼
                 existing /admin/review
                         │
                officer approve / edit / reject / duplicate
                         │
                         ▼
             existing public_opportunities/public_companies
                         │
                         ▼
                    student-facing board
```

The fetch scheduler should never call “publish” logic. It should only create observations, draft updates, and review tasks. The existing review page already states that nothing goes public until approved there, and the public views already restrict output to approved public-safe records. citeturn32view0turn33view1

### Review-task taxonomy

The automated design should stay anchored to the existing `review_tasks.task_type` enum. The current enum already contains `possible_duplicate` and `stale_record`, so automated ingestion should add only four new task types: `source_new`, `source_changed`, `source_reopened`, and `source_health`. Probable automated duplicates should map to existing `possible_duplicate`. Stale, missing, closure-candidate, and archival follow-up should map to existing `stale_record`. Low score is a score band or exclusion reason, not a task type, so the schema should **not** add `reopen_candidate`, `closure_candidate`, or `low_score`.

**6. Database design**

The implementation-ready schema should preserve the current schema and add the following tables.

**New table: `job_sources`**

Purpose: machine-readable approved source registry attached to existing `source_records`.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `source_record_id` | `uuid not null references source_records(id) on delete restrict unique` | reuse existing provenance object |
| `company_id` | `uuid null references companies(id) on delete set null` | nullable for program sources |
| `source_name` | `text not null` | human label |
| `source_kind` | `text not null check in (...)` | `greenhouse`,`lever`,`ashby`,`usajobs`,`nih_program`,`nsf_program`,`nasa_program`,`rss`,`schema_org`,`static_html`,`other_api` |
| `source_identifier` | `text null` | board token, employer slug, API search key |
| `careers_url` | `text not null` | canonical root URL |
| `api_endpoint` | `text null` | resolved endpoint if separate |
| `config_json` | `jsonb not null default '{}'::jsonb` | connector config: selectors, filters, keyword boosts, allowed params |
| `enabled` | `boolean not null default false` | may be true only after required policy review passes |
| `priority` | `smallint not null default 50` | lower = sooner; check `priority >= 0` |
| `fetch_interval_hours` | `integer not null default 24` | check `fetch_interval_hours > 0` |
| `expected_geography` | `text[] not null default '{}'` | |
| `expected_audience` | `text[] not null default '{}'` | |
| `terms_reviewed` | `boolean not null default false` | |
| `terms_review_date` | `date null` | |
| `robots_reviewed` | `boolean not null default false` | |
| `last_attempted_at` | `timestamptz null` | latest scheduler or manual run attempt |
| `last_successful_at` | `timestamptz null` | latest successful completion |
| `consecutive_failures` | `integer not null default 0` | check `consecutive_failures >= 0` |
| `last_http_status` | `integer null` | latest source-level HTTP status |
| `last_payload_hash` | `text null` | latest successful payload hash |
| `degraded_at` | `timestamptz null` | set when source-health follow-up begins |
| `automatic_scheduling_paused_at` | `timestamptz null` | pause timestamp for policy or health holds |
| `notes` | `text null` | |
| `created_by` | `uuid references auth.users(id)` | |
| `updated_by` | `uuid references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | trigger |

Indexes: unique on `source_record_id`; btree on `(enabled, priority)`; btree on `(enabled, fetch_interval_hours)`; index on `company_id`; index on `automatic_scheduling_paused_at`.

Constraints and behavior: enforce source enablement at the database layer so `enabled = true` is allowed only when the required policy-review fields are satisfied, and prefer soft disable/pause over hard deletion for approved sources.

**New table: `source_fetch_runs`**

Purpose: queue + execution log + health basis.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `job_source_id` | `uuid not null references job_sources(id) on delete restrict` | preserve run history |
| `trigger_kind` | `text not null` | `scheduled`,`manual`,`retry`,`recheck` |
| `status` | `text not null` | `pending`,`running`,`completed`,`failed`,`partial`,`cancelled` |
| `scheduled_for` | `timestamptz not null` | |
| `started_at` | `timestamptz null` | |
| `finished_at` | `timestamptz null` | |
| `attempt_no` | `integer not null default 1` | check `attempt_no >= 1` |
| `worker_id` | `text null` | lease/debug |
| `http_status` | `integer null` | source-level status if single request |
| `records_seen` | `integer not null default 0` | check `records_seen >= 0` |
| `records_new` | `integer not null default 0` | check `records_new >= 0` |
| `records_changed` | `integer not null default 0` | check `records_changed >= 0` |
| `records_unchanged` | `integer not null default 0` | check `records_unchanged >= 0` |
| `records_reviewed` | `integer not null default 0` | created review items; check `records_reviewed >= 0` |
| `records_closed_candidates` | `integer not null default 0` | check `records_closed_candidates >= 0` |
| `payload_count` | `integer not null default 0` | check `payload_count >= 0` |
| `error_class` | `text null` | `network`,`timeout`,`robots`,`auth`,`schema`,`rate_limit`,`unexpected` |
| `error_message` | `text null` | truncated |
| `log_json` | `jsonb not null default '{}'::jsonb` | counters, timings |
| `created_at` | `timestamptz not null default now()` | |

Indexes: `(job_source_id, scheduled_for desc)`, `(status, scheduled_for)`, partial index on `status in ('pending','running')`.

Queue claims should happen atomically in the database—for example by claiming eligible rows with `for update skip locked` semantics inside a single statement—so two workers cannot lease the same pending run.

**New table: `source_payloads`**

Purpose: raw provenance metadata. Raw bytes should live in a private Supabase Storage bucket for scale; the row keeps the hash and reference.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `source_fetch_run_id` | `uuid not null references source_fetch_runs(id) on delete cascade` | cascade only when an entire run is intentionally purged |
| `request_url` | `text not null` | final request target |
| `final_url` | `text null` | after redirects |
| `content_type` | `text null` | |
| `etag` | `text null` | |
| `last_modified` | `text null` | |
| `status_code` | `integer null` | |
| `sha256` | `text not null` | |
| `size_bytes` | `integer not null` | check `size_bytes >= 0` |
| `storage_path` | `text not null` | private bucket object path |
| `created_at` | `timestamptz not null default now()` | |

Indexes: unique on `(source_fetch_run_id, sha256, request_url)` if desired; btree on `source_fetch_run_id`.

Supabase buckets can be created through the Dashboard, SQL, or client libraries. For this project, the private payload bucket should be provisioned by a version-controlled migration or a controlled deployment step and then manually verified, rather than treated as a Dashboard-only action.

**New table: `source_postings`**

Purpose: one row per source-specific posting identity, with current normalized state.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `job_source_id` | `uuid not null references job_sources(id) on delete restrict` | preserve source history |
| `external_posting_id` | `text null` | ATS/posting ID |
| `canonical_url` | `text not null` | normalized URL |
| `identity_key` | `text not null` | deterministic resolved identity key |
| `employer_name_raw` | `text null` | |
| `employer_name_normalized` | `text null` | |
| `title_normalized` | `text null` | |
| `location_normalized` | `text null` | |
| `remote_type` | `text null` | `remote`,`hybrid`,`onsite`,`unknown` |
| `employment_type` | `text null` | |
| `classification` | `text null` | `internship`,`entry_level`,`fellowship`,`research`,`other` |
| `department` | `text null` | |
| `focus_area` | `text null` | normalized |
| `posted_at` | `date null` | |
| `closes_at` | `date null` | |
| `deadline_kind` | `text null` | `hard`,`rolling`,`unknown` |
| `current_status` | `text not null default 'open'` | `open`,`missing`,`closure_candidate`,`closed`,`reopened`,`unknown` |
| `relevance_score` | `integer null` | for automated and newly reviewed records only |
| `relevance_score_version` | `text null` | stored rubric version for traceability |
| `score_breakdown_json` | `jsonb not null default '{}'::jsonb` | deterministic scoring explanation |
| `uncertainty_flags` | `text[] not null default '{}'` | ambiguous or caution flags |
| `closure_confidence` | `numeric(5,4) not null default 0` | check `closure_confidence >= 0 and closure_confidence <= 1` |
| `first_seen_at` | `timestamptz not null default now()` | |
| `last_seen_at` | `timestamptz not null default now()` | |
| `last_payload_id` | `uuid null references source_payloads(id) on delete set null` | |
| `last_material_hash` | `text not null` | normalized material hash |
| `consecutive_misses` | `integer not null default 0` | check `consecutive_misses >= 0` |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | trigger |

Uniqueness: unique on `(job_source_id, identity_key)`.  
Indexes: `(job_source_id, current_status)`, `(last_seen_at)`, `(closes_at)`.

**New table: `source_posting_versions`**

Purpose: immutable normalized snapshot history.

| Column | Type |
|---|---|
| `id` | `uuid pk default gen_random_uuid()` |
| `source_posting_id` | `uuid not null references source_postings(id) on delete cascade` |
| `source_fetch_run_id` | `uuid not null references source_fetch_runs(id) on delete restrict` |
| `source_payload_id` | `uuid not null references source_payloads(id) on delete restrict` |
| `connector_version` | `text not null` |
| `is_material_change` | `boolean not null` |
| `material_hash` | `text not null` |
| `normalized_json` | `jsonb not null` |
| `score_breakdown_json` | `jsonb not null default '{}'::jsonb` |
| `field_diff_json` | `jsonb not null default '{}'::jsonb` |
| `created_at` | `timestamptz not null default now()` |

Indexes: `(source_posting_id, created_at desc)`, `(material_hash)`.

Version rows should be append-only, enforced with privileges or a trigger that rejects `update` and `delete` after insert.

**New table: `opportunity_source_links`**

Purpose: map curated opportunities to machine-observed postings, including duplicates across multiple sources.

| Column | Type |
|---|---|
| `id` | `uuid pk default gen_random_uuid()` |
| `opportunity_id` | `uuid not null references opportunities(id) on delete restrict` |
| `source_posting_id` | `uuid not null references source_postings(id) on delete restrict` |
| `match_type` | `text not null` |
| `is_primary` | `boolean not null default false` |
| `created_at` | `timestamptz not null default now()` |

Uniqueness: unique on `(opportunity_id, source_posting_id)`; partial unique index on `(opportunity_id) where is_primary` to allow exactly one primary source link per opportunity.

**Optional but recommended new table: `audit_events`**

Purpose: immutable provenance of source changes and officer actions. This can wait until phase 8.

RLS rules should mirror the existing architecture:

- Base tables above: **officers only** with the same `is_officer()` policy style already used.  
- The private payload bucket should be inaccessible to anon/authenticated non-officers.  
- Public reads should continue to come only from `public_opportunities` and `public_companies`.  
- No new public views are needed for automated internals in MVP. citeturn33view1

Migration sequence:

1. Add enum values and check constraints needed for new source kinds, task types, statuses, and nonnegative counters in an **earlier additive migration**.
2. Add `job_sources`, `source_fetch_runs`, and `source_payloads`.
3. Add `source_postings`, `source_posting_versions`, and `opportunity_source_links`.
4. Add indexes, append-only enforcement, queue-claim helpers, and other triggers.
5. Add RLS and grants.
6. Provision the private storage bucket and bucket policies through a version-controlled migration or controlled deployment step, then manually verify the bucket state.
7. Seed only policy-reviewed approved sources.

Idempotency guidance:

- Use additive migrations only.
- Prefer `create table if not exists`, `alter table add column if not exists`, `create index if not exists`, and guarded policy creation where practical.
- `alter type ... add value` may run inside a transaction, but the new enum value cannot be used until **after commit**. Keep enum additions in an earlier migration and use the new values in a later migration.
- Do **not** rerun `0001_init.sql`; future work belongs in new migrations because the current bootstrap migration is not rerun-safe. citeturn30view0

**7. Connector specification**

The common connector contract should be:

```text
ConnectorInput
- jobSource: { id, sourceKind, sourceIdentifier, careersUrl, apiEndpoint, configJson }
- fetchContext: { runId, now, timeoutMs, userAgent, ifNoneMatch?, ifModifiedSince? }

ConnectorOutput
- requestMeta: { requestUrl, finalUrl, statusCode, contentType, etag?, lastModified? }
- payload: raw bytes/text stored separately, with returned sha256 + size
- postings: NormalizedSourcePosting[]
- pagination: { nextCursor?, exhausted: boolean }
- connectorMeta: { connectorVersion, durationMs, warnings[], errors[] }
```

`NormalizedSourcePosting` should include at minimum:

- `externalPostingId`
- `canonicalUrl`
- `employerRaw`
- `employerNormalized`
- `titleRaw`
- `titleNormalized`
- `locationRaw`
- `locationNormalized`
- `remoteType`
- `descriptionText`
- `qualificationsText`
- `eligibilityText`
- `employmentType`
- `classification`
- `compensationRaw`
- `compensationMin`
- `compensationMax`
- `currency`
- `postedAt`
- `closesAt`
- `department`
- `focusArea`
- `academicLevel`
- `degreeRequirements`
- `experienceRequirements`
- `citizenshipRequirements`
- `workAuthorizationRequirements`
- `sourceType`
- `sourceIdentifier`
- `payloadRef`
- `firstSeenAt`
- `lastSeenAt`
- `currentSourceStatus`
- `normalizationWarnings[]`

Common connector behavior:

- **Timeouts**: 10s connect, 20s total request timeout for MVP; fail safely.
- **Retries**: retry only transient classes (`timeout`, `429`, `502`, `503`, `504`) with exponential backoff and jitter; max 2 retries per source run.
- **Rate limiting**: one source at a time per host in MVP; default delay 1–2 seconds between requests to the same host unless official docs support higher.
- **User agent**: descriptive UA with club name and contact email.
- **HTTP caching**: store and send `ETag` and `If-Modified-Since` when documented or observed.
- **Payload hashing**: SHA-256 over the raw response body.
- **Structured logging**: log connector version, source id, status, duration, retry count, records discovered, normalization warnings.
- **Fixtures**: every connector gets at least 3 fixtures—typical, empty, schema-changed.
- **Versioning**: each connector exports `connectorVersion`; changes to parser logic that can alter normalized output require a minor version bump and fixture updates.

Source-specific requirements:

**Greenhouse**

- Use the official **Job Board API** only.  
- GET endpoints for public job-board data are explicitly documented as public; no auth for reads.  
- Preferred endpoint form: board token + “include full content” option where needed for scoring/normalization.  
- Stored identity: `board_token + job_id`.  
- Good fit for MVP because the interface is designed for custom careers pages and exposes published jobs, departments, and offices. citeturn15search0turn38search0turn15search11

**Lever**

- Use the official public **Postings API** from the official Lever repository and public endpoint examples.  
- Preferred endpoint family: public postings list by site token; request JSON mode when available.  
- Stored identity: `site_token + posting_id`.  
- Treat any auth requirement beyond public postings as out of scope for MVP.  
- If Lever changes public response shapes, isolate breakage to the Lever connector. citeturn16search0turn16search1

**Ashby**

- Start only with sources manually verified during onboarding as publicly readable.  
- Prefer their public job-posting surface for currently published jobs; compensation inclusion is useful when available.  
- Stored identity: organization/board key + posting id.  
- Because current public snippets reviewed leave some auth details ambiguous, onboarding must include a manual “browser-openable without login” test before a source is enabled. citeturn15search2turn15search13turn38search11

**Static HTML source**

- Only approved if: public page, robots reviewed, no login wall, stable DOM, and source owner not opted out.
- Config must declare selectors or XPath for: posting links, title, location, department, posting date, deadline, optional compensation, and “next page” behavior.
- Preferred extraction order: schema.org `JobPosting` markup → JSON blobs in script tags → explicit DOM selectors.
- No headless browser in MVP.
- If page structure changes, the connector should fail with `schema` error and disable itself after consecutive failures rather than ingesting malformed data. citeturn23search1turn23search9turn23search15

**Workday feasibility**

Workday should be **explicitly deferred** in the MVP. The reviewed official materials show a developer program and authenticated enterprise APIs, but not a simple documented public job-board interface comparable to Greenhouse or Lever. In practice, Workday career sites are often site-specific and sometimes JS-heavy. For the MVP, treat Workday employers as manual watchlist sources only. This is partly a documented fact and partly an inference from the reviewed Workday materials. citeturn19search0turn19search4

**8. Normalization specification**

The normalization layer should be deterministic and field-by-field.

**Employer names**

Display form: preserve the source display string.  
Normalized form:

- lowercase
- Unicode NFKC
- trim and collapse whitespace
- replace `&` with `and`
- strip punctuation except meaningful interior hyphens
- remove trailing legal suffixes: `inc`, `inc.`, `llc`, `l.l.c.`, `corp`, `corporation`, `co`, `company`, `ltd`, `lp`, `plc`
- maintain an override alias table for known brands, for example if the source alternates between `Thermo Fisher`, `Thermo Fisher Scientific`, and division names

Deterministic. Unknown alias collisions remain reviewable.

**Titles**

- trim and collapse whitespace
- normalize dash variants to `-`
- remove tracking prefixes like `REQ #`, `JR-12345`, `[REMOTE]`
- preserve title text in display field, derive normalized title separately
- parse season/year terms into structured fields: `summer`, `fall`, `spring`, `2026`
- map clear internship synonyms to classification (`intern`, `internship`, `co-op`, `fellow`, `research assistant`) but do not rewrite display titles

Deterministic except ambiguous seniority phrases, which should raise a flag.

**Locations**

Priority order:

1. source structured location fields if present
2. schema.org `jobLocationType` and `applicantLocationRequirements`
3. parsed free text

Canonical fields:

- `city`
- `region/state`
- `country`
- `location_display`
- `remote_type` = `remote|hybrid|onsite|unknown`

Rules:

- if source explicitly says remote, set remote even if HQ is listed
- text like “Remote - US” stays remote with area restriction note
- multiple locations become a normalized ordered list plus a display string
- “San Diego, CA”, “San Diego, California” normalize to the same key

**Compensation**

- preserve raw text
- parse min/max numeric values when possible
- map `$`, `USD`, `US$` → `USD`
- detect hourly versus annual from units (`/hr`, `hourly`, `per year`, `annual`)
- if range mixes incompatible units, keep raw only and flag
- if only one value is present, set both min and max to that value with `is_exact=true`

**Dates and deadlines**

- parse ISO dates first
- then explicit month names
- then slash formats using U.S. month-first fallback unless source locale dictates otherwise
- invalid dates do not parse; preserve raw text and flag
- “Rolling”, “Open until filled”, “TBD” become `deadline_date = null`, `deadline_kind = rolling|unknown`, raw preserved

**Role categories and focus areas**

Map into the club’s canonical taxonomy:

- biotechnology
- biopharma
- genomics
- molecular biology
- cancer research
- bioinformatics
- clinical research
- diagnostics
- public health
- laboratory operations
- manufacturing
- regulatory affairs
- quality assurance
- project coordination
- academic research

Deterministic keyword/field mapping first; unresolved cases flagged for officer review.

**Eligibility and academic level**

Create normalized booleans / enums from explicit evidence only:

- `undergraduate_eligible`
- `recent_grad_eligible`
- `masters_only`
- `phd_only`
- `degree_required`
- `experience_years_min`

Do not infer “undergraduate-friendly” merely because the role is labeled “entry level” unless the other fields support it.

**Citizenship and work authorization**

Normalize only explicit restrictions such as:

- `U.S. citizens only`
- `U.S. person`
- `must be authorized to work in the U.S.`
- `visa sponsorship unavailable`

This field is security- and fairness-relevant; ambiguous phrasing should remain unresolved and flagged.

**Canonical URLs**

- lowercase scheme and host
- follow one redirect during normalization if the source consistently redirects
- strip tracking parameters like `utm_*`, `gh_src`, `gh_jid` only when they are clearly non-identity parameters
- preserve source identity params if they are the only stable posting identifier
- remove trailing slash differences except when the source treats them distinctly

This is deterministic but source-specific allowlists matter.

**Annual / seasonal cohorts**

The normalization layer must extract structured `season` and `cycle_year` when possible. That is what allows “Summer 2026 Internship” to be treated as a new cohort rather than a silent update to “Summer 2025 Internship.” The existing repo already treats season/year as an identity boundary in its strict and family key design; the automated design should preserve that behavior. citeturn31view4

**9. Deduplication and versioning specification**

The recommended model preserves the current repo’s philosophy but moves the evidence gathering into a staging layer.

### Identity precedence

For matching a source observation to an existing `source_posting`:

1. `(job_source_id, external_posting_id)` if external ID exists
2. `(job_source_id, canonical_url)`
3. `(job_source_id, identity_key)` where `identity_key` is built from normalized employer, normalized title, normalized location, and season/year when relevant

For matching a `source_posting` to an `opportunity`:

1. existing `opportunity_source_links`
2. exact duplicate test
3. probable duplicate test
4. annual recurrence test
5. reopened posting test

### Definitions

**Exact duplicate**

Same employer, same source-specific posting id or same canonical URL after normalization, and no season/year distinction conflict.

**Probable duplicate**

Same normalized employer plus very-similar normalized title and compatible location, but not enough evidence for automatic merge.

**Annual recurrence**

Same employer, same base title after removing season/year tokens, but different cycle year or season.

**Changed posting**

Same source identity, but one or more normalized material fields changed.

**Reopened posting**

A posting previously marked closed/missing becomes visible again under the same source identity.

**Related opportunity family**

A group sharing the same employer and family title root across multiple cycles or locations.

### Edge-case rules

- Same job on employer site and multiple ATS views: create multiple `source_postings`, link them all to one `opportunity` via `opportunity_source_links`, designate one primary source.
- URL changes but external posting ID stays constant: treat as same posting; update source identity and record material change only if normalized user-facing fields changed.
- Company reposts same internship for a new year: create a new opportunity candidate; do not overwrite prior year.
- Rolling internship open indefinitely: keep current cycle active until closure-confidence rules expire it.
- Several locations in one posting: one `source_posting`; one `opportunity`, with multi-location normalized data.
- Multi-opening posting: treat as one posting unless the source provides distinct IDs.
- Slight title changes: version the source posting and create a review task if the curated public record is already approved.
- Approved posting changes after publication: never auto-overwrite public fields; create `import_changed`/`source_changed` review task with field diff.
- Previously removed posting reappears: mark `reopened`, create review task if previously archived.
- Temporary source failure: do not infer closure.
- Tracking parameters create apparent duplicates: canonical URL normalization strips them.

### Automatic versus review-required updates

Automatic updates allowed on an already approved/public opportunity:

- `last_seen_at`
- nonpublic source health metadata
- raw payload references
- additional alternate source links

Automatic updates **not** allowed on an already approved/public opportunity:

- title
- posting URL
- location
- eligibility
- focus area
- deadline or deadline text
- compensation / paid status
- application type
- source status text
- description-derived facts that affect student relevance

Those require a review task. This directly extends the current repository rule that a re-import may update `last_seen_at` but must not silently alter approved public-facing fields. citeturn31view4

### Material-change algorithm

Compute a `material_hash` over this normalized field set:

- title normalized
- canonical URL
- employer normalized
- location normalized
- remote type
- eligibility/academic-level fields
- degree requirements
- experience requirements
- citizenship/work authorization requirements
- department
- focus area
- employment type/classification
- compensation normalized
- posted date
- closing date
- description fingerprint

If the raw payload hash changes but the `material_hash` does not, store a non-material version only if needed for audit; otherwise just update `last_seen_at`.

If the `material_hash` changes:

- create a `source_posting_versions` row
- if the linked opportunity is not public-approved, refresh draft fields automatically
- if it is public-approved, create a `review_task` and leave curated public fields untouched

### Versioning recommendation

Yes, the automated layer needs explicit version history, even though the current curated `opportunities` table can remain the primary published record. The version history belongs in `source_posting_versions`, not in the public table. That keeps publication stable while preserving reproducibility.

**10. Relevance scoring rubric**

The system should remain deterministic and transparent. I recommend a **0–100 additive rubric**. Expanded scoring should initially apply only to **automated discoveries and newly reviewed records**, not to the full historical catalog on day one. Store a `relevance_score_version` alongside each scored automated observation so rubric changes remain traceable.

### Hard exclusions

Automatically reject or hold below publication threshold if any of the following is true:

- posting is closed or deadline clearly passed
- source is not in the approved registry
- page requires login or CAPTCHA
- description is inaccessible after recheck
- explicit seniority above plausible student level, for example `senior`, `staff`, `principal`, `director`, `manager`, or explicit minimum experience `>3 years`
- duplicate already linked to a surviving opportunity
- source terms or robots review fail
- role is obviously unrelated to the hub scope

### Base scoring

Start at **40**.

### Positive signals

- explicit undergraduate eligibility: **+20**
- recent graduate eligibility: **+10**
- internship / co-op / fellowship / REU / student research classification: **+15**
- entry-level full-time that is realistically attainable: **+8**
- degree requirement compatible with BS or “pursuing BS”: **+8**
- scientific relevance to biotech/life sciences: **+12**
- lab / research relevance: **+10**
- bioinformatics / data / computational biology relevance: **+8**
- Southern California location: **+10**
- remote role open to U.S. students or broad geography: **+8**
- official employer/program source: **+5**
- compensation stated: **+5**
- paid / stipend: **+8**
- recency under 14 days: **+5**
- explicit deadline present and future: **+5**

### Negative signals

- graduate-only but not undergrad-friendly: **-20**
- PhD-only: **-25**
- explicit required experience `2–3 years`: **-8**
- explicit required experience `>3 years`: **-20**
- no application link / broken apply path: **-15**
- no location information: **-5**
- unpaid: **-8**
- citizenship or work-authorization restriction that excludes many students: **-10** and uncertainty flag
- ambiguous eligibility: **-5** and uncertainty flag

### Thresholds

- **75–100**: high priority review
- **55–74**: normal review
- **35–54**: low-confidence review
- **0–34**: reject by rule or hold for officer confirmation only

### Examples

High-scoring example: “Summer 2027 Biology Research Intern,” paid, Orange County, undergrad eligible, official employer page, posted in last week, clear deadline. This will usually land in the **80s or 90s**.

Medium-scoring example: entry-level manufacturing associate in San Diego requiring BS and 0–1 years experience, no internship label, official employer page, compensation omitted. This usually lands in the **60s**.

Low-scoring example: senior regulatory affairs manager, Bay Area, 5+ years required, no student language. This should fall **below threshold or be hard-excluded**.

### LLM role

For the MVP, LLM use should be **advisory only** and disabled by default. If added later, it may help with:

- summarizing long descriptions for officers
- suggesting focus areas
- marking ambiguous eligibility for review

But every production-critical field must have a deterministic fallback, and LLM outputs must never publish automatically.

## Scheduling, workflows, and safeguards

**11. Scheduling and failure-recovery design**

The recommended MVP scheduler is **Supabase Cron → scheduler Edge Function → batched worker Edge Functions → database queue via `source_fetch_runs`**. Supabase Cron is integrated with Postgres and Edge Functions, while Vercel Hobby cron is too limited for sub-daily or precise scheduling, and GitHub Actions scheduled workflows can auto-disable in inactive public repos. citeturn24search0turn24search12turn24search1turn24search2turn24search3

### Schedule recommendation

- **Daily** for most employer and program sources.
- **Twice daily** only for very high-value fast-moving ATS sources after MVP.
- **Weekly** for low-change academic directories or program pages.

### Batching

- Scheduler runs every day and inserts pending runs for due sources.
- Each worker invocation claims a **bounded batch** of at most **5–10 pending runs** depending on expected source latency.
- Each run processes **one source only** to preserve isolation and make retries/source health decisions easy to reason about.
- If 50+ sources are configured, the scheduler fans out more pending runs; multiple worker invocations drain them without sharing the same claimed row.

### Retries and backoff

- Transient errors: retry twice with exponential backoff.
- `429`: back off more aggressively and increment a `source_health` warning path.
- Parser/schema error: no blind retry; mark failed and alert.
- After **3 consecutive failures**, set `degraded_at`, create or refresh a `source_health` review task, and use `automatic_scheduling_paused_at` if policy requires pausing the source instead of inventing a new task type.

### Timeout behavior

- Per request timeout: 20 seconds total.
- Per source run soft timeout: 60 seconds.
- Worker hard timeout must stay comfortably below the Supabase wall-clock limit on the project plan. Free plan Edge Functions have a shorter limit than paid plans, so batching should be conservative. citeturn24search1turn24search13

### Failure isolation

- One source failure must not abort the batch.
- Each source run owns its own transaction boundary; write partial logs even on failure.
- Closure logic must never run based on failed fetches alone.

### MVP platform comparison

- **Supabase Cron + Edge Functions**: best MVP fit because it is database-local, secret-friendly, and avoids GitHub/Vercel cron edge cases.  
- **Future architecture**: if the source count grows toward 100–500 and some sources become slow, move workers to a dedicated queue/worker service while keeping the same database schema and review flow.

**12. Security and legal assessment**

### Threat model

The main risks are:

- service-role key exposure
- unauthorized source changes
- SSRF through URL fetchers
- stored HTML / XSS from job descriptions
- malicious CSV or payload content
- preview deployments accidentally pointing at production secrets
- connector failures silently affecting publication
- terms/robots violations
- poisoned or misleading external content

### Technical mitigations

**Service-role key exposure**

- Keep the service-role key exclusively in server-only contexts.
- Scheduled ingestion should run in Supabase Edge Functions or protected Vercel server functions only.
- No client bundle may import code paths that touch the service key.
- Production service-role credentials are **production-only**. Preview deployments receive **no production service-role key**; if privileged preview testing is ever needed, use a separate staging project and staging key instead.
- The current repo already shows the right pattern in CI by using dummy env vars and in admin actions by re-checking officer status before service-client usage. citeturn12view0turn32view1turn26search17

**RLS and authz**

- Keep base-table RLS “officers only,” but describe its role accurately: the service-role client bypasses RLS.
- Middleware verifies session presence only; `requireOfficer()` is the decisive officer-membership check before privileged service-role use.
- Every privileged admin mutation must verify: authenticated Supabase session, active membership in `officers`, and server-only execution.
- Scheduled functions do not rely on user RLS; they run with a server secret in isolated code and leave publication decisions to officers. citeturn33view1turn26search1turn26search17

**SSRF**

- Fetch only allowlisted domains from approved `job_sources`.
- Reject non-HTTP(S) schemes.
- Reject localhost, RFC1918/private IP targets, metadata IPs, and redirect chains leaving approved host patterns.
- Cap response size, follow at most one redirect, and store only sanitized text or raw bytes privately.

**Stored HTML / XSS**

- Never render raw employer HTML on the public site.
- Normalize to plain text for officer review.
- Publish structured facts plus short officer-written summaries and canonical links only.
- Escape all output in React as usual and avoid `dangerouslySetInnerHTML` for external content.

**CSV / export safety**

- Any future CSV export should neutralize spreadsheet formula-injection prefixes (`=`, `+`, `-`, `@`) in user-controlled text.
- Treat imported or fetched URLs as untrusted until validated.

**CSRF and mutation boundaries**

- New admin route handlers for source controls should verify origin/host and officer status.
- Prefer server actions or route handlers that do not expose mutation logic to unauthenticated callers.

**Logging**

- Never log secrets, auth headers, or full signed URLs.
- Store truncated error text and structured counters.

### Legal and policy constraints

Robots.txt is **not** an access-control system, but it is an established standard that crawlers are expected to honor. The system should therefore review robots during source onboarding and record that review in the registry. Request volume should be conservative even when robots permit crawling. citeturn23search3turn23search15

The conservative content-retention model should be:

- **Private**: raw payloads, normalized snapshots, field diffs, and officer notes.
- **Public**: canonical link, structured facts, source attribution, and short officer-written summary.
- **Avoid publishing full copied job descriptions** unless a specific source’s terms clearly allow it and the club intentionally decides to do so. Copyright and licensing risk are materially lower when the public board shows facts and summaries rather than duplicating full text.

Recommended retention:

- raw payloads: **180 days**
- normalized versions: **indefinite for audit** or at least **1 year**
- archived/closed public opportunities: per existing retention policy
- employer opt-out: immediate disablement of the source and removal from future fetch schedules

The system should also expose a visible disclaimer that the board is a student-curated informational service and does **not imply endorsement by CSULB or the club**.

### Platform-policy exclusions

LinkedIn and Handshake should be excluded as foundation sources. LinkedIn states that third-party software that exports or scrapes data or automates tasks violates its User Agreement, and Handshake states that it does not permit third parties to bulk collect job descriptions or other marketplace information through scraping or automated scripts. Indeed also restricts unauthorized automation around its workflows. These are not good core dependencies for a small student-run board. citeturn27search4turn27search8turn27search1turn27search2

**13. Administrative workflow**

The smallest effective MVP additions to the existing admin UI are:

1. **Source registry page**  
   Table of approved sources with columns: enabled, source kind, organization, last successful fetch, consecutive failures, next due, priority, and terms/robots reviewed.

2. **Source detail page**  
   Show careers URL, connector type, config, last 10 runs, recent errors, and button actions: run now, disable, retry latest, view payload metadata.

3. **Automated-ingestion review filters in existing review UI**  
   Add filter chips for:
   - source
   - score band
   - changed existing record
   - probable duplicate
   - stale/missing
   - employer

4. **Field-level diff panel**  
   For changed records, show:
   - currently approved public fields
   - latest source-observed fields
   - changed fields highlighted

5. **Health dashboard summary card**  
   Total enabled sources, failed in last 24h, sources disabled, pending review count from automation.

6. **Bulk actions limited to safe cases**  
   Bulk reject duplicates or low-score irrelevant items, but no bulk publish without an officer review click.

This is deliberately smaller than a full operations console. The current admin already has the essential review skeleton; the missing piece is visibility into sources and diffs. citeturn32view0turn13view9turn10view3

## Validation, cost, and implementation

**14. Testing and acceptance criteria**

The automated system should ship only when these acceptance tests pass.

| Test | Pass condition |
|---|---|
| Identical rerun idempotency | Rerunning the same source without source changes creates no duplicate `source_postings`, no duplicate `opportunities`, and no extra review tasks beyond audit logs. |
| Approved record protection | A material change in a source linked to an approved public opportunity creates a review task and does **not** alter the public view until officer approval. |
| Draft auto-refresh | A material change in a source linked only to a nonpublic draft updates the draft automatically and records a new version. |
| Annual recurrence separation | “Summer 2026” and “Summer 2027” roles remain distinct opportunities. |
| Duplicate family handling | Same job observed on two sources links to one curated opportunity, preserving two source links. |
| Single-source failure isolation | One connector failure does not abort remaining source runs in the batch. |
| No false closure on one miss | One failed fetch or one missing response does not close an opportunity. |
| Closure after repeated misses | A posting is marked closure-candidate only after configured miss threshold and then routed to review or automatic expiry under the chosen policy. |
| Public-safe publication only | Automated discoveries begin in nonpublic review state and never appear in `public_opportunities` without officer approval. |
| Secret containment | Build artifacts and client bundles contain no service-role key. |
| SSRF guard | URLs pointing to localhost/private IPs/unsupported schemes are rejected before fetch. |
| XSS guard | Raw source HTML never renders unsanitized in the admin or public UI. |
| Malformed payload safety | Unexpected JSON/HTML shapes fail with logged connector errors and do not create malformed opportunities. |
| Queue safety | Two worker invocations do not process the same pending run concurrently. |
| Source disable kill switch | Disabling a source prevents the scheduler from queueing it again. |

Repository-level test plan:

- connector unit tests with fixtures
- normalization unit tests
- dedupe tests
- scoring tests
- version-change tests
- migration smoke tests on fresh DB
- route/Edge Function auth tests
- preview deployment smoke tests
- production post-deploy smoke tests

The CI currently runs `typecheck` and `build`; automation work should add unit tests and migration smoke coverage before merge. citeturn12view0

**15. Cost estimate**

The free-tier feasibility is driven more by **scheduler/runtime limits** than by raw bandwidth. Vercel Hobby cron is limited to **once per day** with **hour-level precision**, and Vercel does **not retry** failed cron invocations. Supabase Edge Functions have finite wall-clock limits, with a shorter free-plan limit and higher paid-plan limit. GitHub Actions is a poor primary scheduler because public-repo scheduled workflows can auto-disable after 60 days of inactivity. Those are the real upgrade points. citeturn24search2turn25search0turn24search1turn24search13turn24search3

Estimated operational profile, assuming one daily fetch per source and raw payloads stored privately with 180-day retention:

| Scale | Free-tier feasibility | Likely storage footprint | Compute posture | Maintenance posture |
|---|---|---|---|---|
| 25 sources | Feasible if batching is conservative and most sources are simple ATS/API reads | Very small; roughly tens to low hundreds of MB over months | Usually within daily serverless batch budgets | Light |
| 50 sources | Feasible but more comfortable on paid Supabase if you want headroom and better runtime duration | Low hundreds of MB over months | Multiple worker batches per day | Light to moderate |
| 100 sources | Paid Supabase strongly preferred; Vercel Hobby cron no longer attractive | A few hundred MB to around 1 GB over retention window depending on payload size | Queue batching required | Moderate |
| 500 sources | No longer an MVP shape; move toward dedicated worker/queue architecture | Low single-digit GB range over retention windows | External worker likely justified | Significant |

These storage estimates are **engineering inferences**, not documented platform quotas: they assume roughly 50–100 KB average payloads for API/feed responses and modest version churn. In practice, richly rendered HTML pages can be larger.

Optional LLM use is not recommended for MVP cost reasons. Commercial job-data APIs should also be deferred because they trade engineering simplicity for recurring vendor cost and provenance opacity.

**16. Implementation plan**

### Phase 0: repository and data audit

- **Objective**: confirm schema assumptions, identify seed/demo data, verify current public/private boundaries.
- **Files likely affected**: none or docs only.
- **Database changes**: none.
- **Tests**: migration smoke check, public-view smoke check, reviewed-record overwrite smoke check.
- **Dependencies**: none.
- **Risk**: low.
- **Estimated time**: 4–6 hours.
- **Acceptance criteria**: written audit complete; exact reuse plan agreed.

### Phase 1: database schema foundation

- **Objective**: add the additive schema only: `job_sources`, `source_fetch_runs`, `source_payloads`, `source_postings`, `source_posting_versions`, `opportunity_source_links`, required enum values, constraints, RLS, and the private payload bucket.
- **Files likely affected**: new migration; shared types.
- **Database changes**: new tables, indexes, RLS, append-only/versioning enforcement, queue-claim helper, private storage bucket.
- **Tests**: schema/RLS smoke tests; constraint tests; queue-claim concurrency tests.
- **Dependencies**: phase 0.
- **Risk**: medium.
- **Estimated time**: 6–10 hours.
- **Acceptance criteria**: the database is ready for controlled source seeding and worker development without shipping admin source pages, server actions, or dashboard UI yet.

### Phase 2: Greenhouse connector

- **Objective**: implement connector, payload retention, normalization, and opportunity/review wiring for Greenhouse.
- **Files likely affected**: `src/lib/connectors/greenhouse.ts`, normalization utilities, dedupe bridge, worker route/function.
- **Database changes**: use existing new tables only.
- **Tests**: Greenhouse fixtures; idempotent rerun; approved-record protection.
- **Dependencies**: phase 1.
- **Risk**: low.
- **Estimated time**: 8–12 hours.
- **Acceptance criteria**: one Greenhouse source can fetch, create drafts, and create review tasks without public publication.

### Phase 3: Lever connector

- **Objective**: implement Lever public Postings connector.
- **Files likely affected**: `src/lib/connectors/lever.ts`, tests.
- **Database changes**: none beyond phase 1.
- **Tests**: Lever fixtures; pagination/filter behavior if used.
- **Dependencies**: phase 2 patterns.
- **Risk**: low.
- **Estimated time**: 6–10 hours.
- **Acceptance criteria**: one Lever source works end-to-end.

### Phase 4: Ashby connector

- **Objective**: implement public Ashby connector with onboarding guard that verifies public accessibility.
- **Files likely affected**: `src/lib/connectors/ashby.ts`, onboarding validation UI.
- **Database changes**: none beyond phase 1.
- **Tests**: Ashby fixtures; public-access precheck; compensation parsing where present.
- **Dependencies**: phase 1.
- **Risk**: medium because public-access patterns vary.
- **Estimated time**: 6–10 hours.
- **Acceptance criteria**: at least one public Ashby source works end-to-end.

### Phase 5: scheduling and logging

- **Objective**: add scheduler, worker batching, retries, and structured source-run logs.
- **Files likely affected**: Supabase Edge Functions or protected server routes; source admin dashboard.
- **Database changes**: maybe additional status columns only.
- **Tests**: lease/claim tests, retry tests, failure-isolation tests.
- **Dependencies**: phases 1–4.
- **Risk**: medium.
- **Estimated time**: 8–12 hours.
- **Acceptance criteria**: daily scheduled run processes sources independently and logs outcomes.

### Phase 6: stale-record detection

- **Objective**: implement closure-confidence tracking, miss counters, recheck behavior, and archival routing.
- **Files likely affected**: worker logic, review-task creation, review UI filters.
- **Database changes**: possibly small additions to `source_postings`.
- **Tests**: one miss does not close; repeated misses do.
- **Dependencies**: phase 5.
- **Risk**: medium.
- **Estimated time**: 6–8 hours.
- **Acceptance criteria**: stale sources generate reviewable outcomes without false closures.

### Phase 7: admin source controls

- **Objective**: add source registry UI, health dashboard, diffs, and manual trigger/disable controls.
- **Files likely affected**: new admin routes/components.
- **Database changes**: none.
- **Tests**: authz tests, UI action tests.
- **Dependencies**: phases 1 and 5.
- **Risk**: low to medium.
- **Estimated time**: 8–12 hours.
- **Acceptance criteria**: officers can operate the ingestion system without SQL editor access.

### Phase 8: production hardening

- **Objective**: security review, preview-vs-production credential separation, alerting, documentation, fixture refresh, handoff docs.
- **Files likely affected**: docs, workflows, middleware, deployment config.
- **Database changes**: optional `audit_events`.
- **Tests**: security tests, preview smoke tests, disaster-recovery checklist.
- **Dependencies**: all prior phases.
- **Risk**: medium.
- **Estimated time**: 12–20 hours.
- **Acceptance criteria**: another technically capable officer can operate the system using docs.

**17. Prioritized backlog**

### Issue: Add automated source registry backed by `job_sources`

- **Rationale**: automation needs a source allowlist with policy review and machine config.
- **Scope**: migration, enum additions, constraints, queue-claim support, and controlled seeding fields.
- **Non-goals**: admin CRUD, dashboard UI, or connectors.
- **Technical notes**: `job_sources` should reference `source_records`, enforce policy-reviewed enablement, and retain source health metadata.
- **Acceptance criteria**: the schema supports controlled creation, pausing, health tracking, and seeding of approved sources without adding admin pages yet.
- **Dependencies**: none.
- **Security considerations**: officer-only mutation paths; no open fetch target entry for non-officers; production service-role key stays out of preview.
- **Estimated effort**: medium.

### Issue: Implement Greenhouse ingestion connector

- **Rationale**: best low-risk first connector.
- **Scope**: fetch, payload retention, normalization, staging upsert, review-task routing.
- **Non-goals**: application submission.
- **Technical notes**: public GET only.
- **Acceptance criteria**: one approved Greenhouse board ingests into review queue.
- **Dependencies**: source registry.
- **Security considerations**: allowlist host, payload-size limits.
- **Estimated effort**: medium.

### Issue: Implement Lever public postings connector

- **Rationale**: second low-risk ATS connector.
- **Scope**: same as Greenhouse.
- **Non-goals**: private Lever Data API.
- **Technical notes**: public postings only.
- **Acceptance criteria**: one Lever board ingests safely.
- **Dependencies**: source registry.
- **Security considerations**: host allowlist and source onboarding.
- **Estimated effort**: medium.

### Issue: Implement Ashby public postings connector with onboarding verification

- **Rationale**: valuable ATS coverage with slightly more onboarding variance.
- **Scope**: connector + preflight verification that source is public.
- **Non-goals**: confidential-job API access.
- **Technical notes**: fail closed if accessibility unclear.
- **Acceptance criteria**: one public Ashby board ingests safely.
- **Dependencies**: source registry.
- **Security considerations**: no employer secrets stored for MVP.
- **Estimated effort**: medium.

### Issue: Add scheduler and batched workers using Supabase Cron

- **Rationale**: move from manual-only to recurring automated collection.
- **Scope**: scheduler job, queue claiming, retries, run logs.
- **Non-goals**: external queue service.
- **Technical notes**: use `source_fetch_runs` as queue.
- **Acceptance criteria**: daily processing runs without source coupling.
- **Dependencies**: at least one connector.
- **Security considerations**: service-role secret stays in server-side function only.
- **Estimated effort**: medium to large.

### Issue: Add source posting versioning and protected-change review tasks

- **Rationale**: preserve public approved content while tracking source changes.
- **Scope**: `source_postings`, `source_posting_versions`, diff logic, review task creation.
- **Non-goals**: public history UI.
- **Technical notes**: material-hash based diffing.
- **Acceptance criteria**: approved records never silently change.
- **Dependencies**: connector infra.
- **Security considerations**: immutable audit rows.
- **Estimated effort**: medium.

### Issue: Add stale-listing detection and reopening logic

- **Rationale**: automated sources need lifecycle management.
- **Scope**: miss counters, closure confidence, reopen handling.
- **Non-goals**: browser automation rechecks.
- **Technical notes**: one miss must not close.
- **Acceptance criteria**: closure decisions require repeated evidence.
- **Dependencies**: source postings.
- **Security considerations**: avoid destructive automation.
- **Estimated effort**: medium.

### Issue: Add admin source health dashboard and diff review UI

- **Rationale**: officers need the smallest workable operations surface.
- **Scope**: registry overview, last fetch, failures, trigger now, diffs.
- **Non-goals**: full observability product.
- **Technical notes**: integrate into existing admin nav.
- **Acceptance criteria**: officer can identify and fix one broken source in under 5 minutes.
- **Dependencies**: scheduler and versioning.
- **Security considerations**: officer only.
- **Estimated effort**: medium.

### Issue: Production hardening for preview isolation and secret hygiene

- **Rationale**: scheduled automation amplifies blast radius.
- **Scope**: env separation, staging project guidance, security tests, docs.
- **Non-goals**: enterprise IAM.
- **Technical notes**: previews should not use unrestricted production service key.
- **Acceptance criteria**: preview can deploy without production-risk secrets.
- **Dependencies**: all major features.
- **Security considerations**: highest importance.
- **Estimated effort**: medium.

## Risk and conclusion

**18. Risk register**

| Risk | Likelihood | Impact | Detectability | Mitigation | Residual risk |
|---|---|---:|---:|---|---:|
| Public approved records silently changed | Medium | Very high | High | Separate staging/versioning layer; review-task gating | Low |
| Service-role key exposure | Medium | Very high | Medium | Server-only use, preview isolation, secret scans, no client imports | Low to medium |
| Source-policy / ToS violation | Medium | High | Medium | Official APIs first; onboarding review of terms/robots; opt-out support | Medium |
| Source breakage from vendor schema changes | High | Medium | High | Per-connector fixtures, failure isolation, source disable switch | Medium |
| False closure of active postings | Medium | High | High | Consecutive-miss threshold, grace period, manual review triggers | Low |
| Officer overload from too many low-quality records | Medium | High | High | Curated registry, deterministic scoring, thresholds, source prioritization | Medium |
| SSRF through source fetch URLs | Low to medium | High | Medium | Host allowlist, redirect limits, IP blocking | Low |
| XSS or poisoned description rendering | Medium | High | High | Plain-text extraction only, no raw HTML render | Low |
| Preview environment mutates production | Medium | High | High | Separate staging Supabase or no service role in preview | Low |
| Student-officer turnover causes maintenance loss | High | Medium | High | explicit docs, small connector set, phase-based rollout, handoff checklist | Medium |

**19. Go or no-go conclusion**

**Go**, with a tightly scoped MVP.

The project should proceed because the current repository already contains the hardest governance pieces: public-safe views, officer-only review, deterministic dedupe and scoring, and approved-record overwrite protection. The correct MVP is **not** “scrape the whole internet.” It is a **curated automated-ingestion layer** over a short list of defensible sources. citeturn31view4turn32view0turn33view1

The MVP should include:

- source registry
- Greenhouse connector
- Lever connector
- one carefully verified Ashby connector
- USAJOBS connector or importer
- at least a few official program sources such as NIH/NSF/DOE/NASA
- scheduler + worker batching
- raw payload provenance
- source posting/version tables
- review-task generation for new, changed, duplicate, and stale records
- minimal source health dashboard

The MVP should explicitly defer:

- LinkedIn, Handshake, Indeed, Glassdoor as foundation sources
- Workday, iCIMS, Taleo, ADP connectors
- browser automation for JS-heavy sites
- unrestricted search-engine scraping
- commercial aggregator APIs
- LLM-dependent extraction
- auto-publishing of any kind

Estimated time to a **functional MVP**: **50–72 engineering hours**.  
Estimated time to a **production-hardened release**: **80–120 engineering hours**.

Expected weekly officer workload after rollout:

- **30–60 minutes/week** at 10–20 active sources
- **60–90 minutes/week** at 25–40 active sources

Expected monthly technical maintenance burden:

- **1–2 hours/month** at MVP scale
- **3–6 hours/month** if the source count or connector diversity grows materially

The best long-term posture for future officers is to keep the automated layer **small, documented, and connector-first**, and to use the alumni database only as a consent-aware enrichment/prioritization input rather than a scraping target.