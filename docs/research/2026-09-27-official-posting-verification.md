# Official-posting verification: findings, evaluation and activation

Branch `feat/official-posting-verification`, stacked on draft PR #123 (`feat/autonomous-discovery-20260926`, head `710634e`). Prepared 2026-09-26/27. Every number below comes from an offline replay on the fixed evaluation set. None of it measures live coverage. Live search and verification have not been run.

## 1. The pipeline as it actually runs

```
Vercel cron /api/cron/ingest (daily 14:00 UTC, 300 s) ──┐   GitHub Actions recovery cycle (14:15 UTC) ──┐
                                                        ▼                                               ▼
runPipelineCycle ─ recover stale runs ─ schedule_due_source_fetch_runs ─ runIngestionBatch ─ reconcile ─ discovery ─ extraction ─ sheet
                                         (enabled + terms + robots +      (job_sources only:             (Brave; off unless
                                          not paused)                     Greenhouse/Ashby/Lever/        DISCOVERY_SEARCH_ENABLED)
                                                                          USAJOBS/static page)
```

* **Source registry and governance.** `job_sources` rows carry `enabled`, `terms_reviewed` + `terms_review_date`, `robots_reviewed` and `automatic_scheduling_paused_at`. `sourceGovernanceError()` in `source-runner.ts` and the scheduler SQL enforce them. The admin page `/admin/sources` edits them. Production had three enabled Greenhouse boards on 2026-09-24: Flagship (later disabled as Northeastern-only), Ginkgo and Xaira.
* **Fetch chain.** `safeFetch` (SSRF guards, manual redirects) → `fetch-chain.ts` tiers (conditional GET, Scrapling, ScrapeGraph scrape-only) → connectors → `persistFetchResultWithSupabase` → `source_fetch_runs`, `source_payloads` (private bucket `source-payloads`), `source_postings`, `source_posting_versions`. A **completed fetch run is an inventory assertion**: the trigger `mark_missing_source_postings_after_complete_run` marks every unseen posting of that source missing. For that reason, verification of a single page must never be recorded as a `source_fetch_runs` row.
* **Extraction evidence.** `pipeline_extractions` binds model output to quotes in the stored text (`evidence.ts`). It runs only on `source_posting_versions`, which means only on governed feeds.
* **Discovery (PR #123).** Search observations go to `discovery_leads` / `discovery_lead_observations` through `archive_discovery_lead`. PR #123's migration keeps routine observations archive-only and creates a `source_new` task only for a distinct exact-role candidate attached to source research. `source-research-discovery.ts` attaches an indexed URL to `user_submissions.payload.candidate_employer_url` with `posting_status=unknown`.
* **Review queue.** `/admin/review` tabs: opportunities (`needs_review`), discovery leads, submissions/source research, tasks. Officers resolve provenance, create private drafts and approve. Nothing automated publishes.

## 2. Failure points confirmed in code and on the evaluation set

| # | Where | What happens | Evidence |
|---|---|---|---|
| F1 | Employer universe | 43 of 86 distinct roles belong to employers that are neither in the 185-row alumni inventory nor in the historical watch (Roche, Elanco, Fred Hutch, MD Anderson, IBRI, Nanopath, Boehringer, Arthrex, Kyowa Kirin, Stryker, MTF, Agilent, BeOne, Keros, HonorHealth, Medpace, Aldevron...). No employer query is ever issued for them. | before arm: `employer_not_scheduled` = 43 |
| F2 | Marketing domains | Inventory `website` values are marketing hosts (`www.gilead.com`, `www.gene.com`). Requisitions live on `gilead.wd1.myworkdayjobs.com`, `gilead.yello.co`, `roche.wd3.myworkdayjobs.com/rog-a2o-gene`. `site:` searches of the marketing host find no requisitions. | `employer-inventory.ts` `careersHost(website)` |
| F3 | Restrictive query arms | Lane arm 2 requires science term **and** opportunity term **and** `(2027 OR summer)` **and** an eligibility phrase. It can match 0/86 evaluation roles by title. All legacy lane queries together reach 13/86. The PALM and AI co-op, "Research Intern, Temporary", "R&D Lab Analyst" and "Intern" titles carry no science word, year or degree. | `query-families.test.ts` |
| F4 | Truncated stems quoted | Lane queries quote taxonomy stems (`"oncolog"`, `"immunolog"`, `"neurodegener"`, `"bioinformatic"`). Whole-word engines do not match these to "oncology" or "immunology". | legacy `buildLaneSearchPlans` |
| F5 | Undocumented grouping and length | Queries rely on parentheses. Brave documents `site:`, quotes and uppercase `AND/OR/NOT`, but not grouping, and marks operators experimental. Before this change, 370 of 925 employer queries were over 50 words and 183 were over 400 characters. | Brave operator docs; measured |
| F6 | Requisition parsing | PR #123's Workday pattern rejects IDs with hyphens (`202608-121913`, `REQ-30507-1`, `R-2026-49482`). Its fallback returns nothing for iCIMS, Radancy, SuccessFactors, PrismHR, ADP, ORISE codes and Greenhouse embeds. Correct requisition was found for 29/57 labelled URLs. | URL-level score |
| F7 | Candidate acceptance | The source-research gate accepts only recognized ATS hosts or the known careers domain. It needs 80% title-token overlap with the screenshot title, and screenshot titles add cities or abbreviate ("Global Reg Affairs"). 19 known employer URLs are rejected. | `candidate_url_rejected` = 19 |
| F8 | Tenant attribution | Discovery labels any recognized ATS hostname as an employer-controlled URL for the hinted employer. 3 of 6 misleading-tenant traps are attributed wrongly: a Roche Diagnostics Workday site treated as Genentech, the Danaher parent tenant treated as Aldevron, and an unregistered Greenhouse board. | `attributionTraps.beforeWrongClaims` |
| F9 | No verification step | An indexed URL never becomes employer evidence. No fetch, snapshot, hash, redirect chain or gate quote exists for a discovery candidate, so 0/68 roles with known URLs get an evidence-backed decision. | before arm |
| F10 | No officer signal for discovered roles | Broad-search observations are archive-only by design, and only research candidates open a task. Before this change, even a discovered role reaches an officer only if someone browses the leads tab. | PR #123 migration |
| F11 | Governed source coverage | The three production Greenhouse boards cover **0** of the 35 recruiting tenants behind the set's 68 known URLs. Any automatic verification that respects governance can verify nothing until officers review sources for the tenants that matter. | production-governance arm: 0 reach review |
| F12 | Client-rendered ATS | 22/68 known URLs are Workday/ADP pages that return a script shell to a plain HTTP GET. A 200 there means nothing. | `script_only_page` = 22 |

## 3. What changed

* `posting-identity.ts` plus `data/ats-tenant-registry.json` parse Workday, Greenhouse (hosted and embedded), Lever, Ashby, iCIMS, Yello, PrismHR, ADP, Radancy, SuccessFactors, Phenom, J&J and ORISE URLs into a system, tenant and requisition. Locale, location path, tracking and trailing-slash variants collapse to one identity key. Workday re-post suffixes such as `R0026869-1` normalize to `R0026869`, while numeric IDs such as `202608-121913` are kept whole. The registry records employer ownership, operating companies (Kite on Gilead, Aldevron on Danaher) and shared hosts (ORISE, Danaher). A parent or shared tenant is attributed only when the fetched page names the employer. **The registry never authorizes a fetch.**
* `posting-evidence.ts` classifies a fetched page into one of 11 states: `apply_visible`, `closed`, `removed`, `expired`, `blocked`, `script_only`, `error_page`, `redirected_away`, `requisition_conflict`, `fetch_error` or `ambiguous`. `apply_visible` requires an Apply control in the stored text, no closure or error language, and a consistent requisition. A 200 alone gives `ambiguous` or worse. It extracts deadline, term, degree level, year in program, continued enrollment, institution restriction (named-institution-only, regional affiliation or home-institution exclusion), academic credit and work authorization. Each value comes with a quote that is a literal substring of the stored text, or is explicitly `not_stated` or `unknown`.
* `posting-verification.ts` makes one pure outcome decision and a duplicate decision across `opportunities`, `source_postings`, `discovery_leads`, `user_submissions` and earlier verifications. Distinct requisitions are never merged; same-title siblings are listed as `related`.
* `verification-runner.ts` selects a bounded batch (default 5, maximum 20), deduplicating before any fetch. Governance works per tenant:
  * A reviewed Greenhouse, Lever or Ashby feed answers from its own archived `source_postings` and payload, with no new fetch.
  * An employer host is fetched only when an enabled source with dated terms and robots reviews, and not paused, carries an officer-set `config_json.requisition_verification` scope for that exact host and path prefix.
  * Otherwise the candidate is recorded as a coverage gap without a fetch.

  The runner uses `safeFetch` (now recording each redirect hop and the content type) and Scrapling only when `PIPELINE_SCRAPLING_ENABLED=true`. The paid tier is never used. It keeps at least 2 s between requests to one host, fetches at most 3 times per host per run, and stops requesting a host for the rest of the run after a 401, 403 or 429. Snapshots go to `source-payloads/verification/...`, never through `source_fetch_runs`. Contact data is redacted from quotes and task notes.
* Migration `20260927090000_official_posting_verification.sql`:
  * Adds the append-only, private `posting_verifications` table. Officers can select; service_role can insert; no role can update or delete.
  * Adds a service-only `record_posting_verification(jsonb)` RPC that is idempotent. It opens one `source_new` task per requisition, and only for a `review_candidate`.
  * Updates `schedule_due_source_fetch_runs` so that a verification-only source is never list-fetched.

  Check constraints forbid `apply_visible` without a stored hash and snapshot, a review candidate without a requisition identity, and a fetched row without a retrieval time.
* Query families (`query-families.ts`, used by `search-plan.ts`):
  * Short queries with one OR list and no parentheses, all under 380 characters and 40 words.
  * Recall arms never require a year, season, degree or science term. The graduate arm is a separate, opt-in precision arm.
  * Employer arms: roles, tenant `site:` (no title vocabulary, which reaches generic technology co-ops), off-cycle, historical program names, LinkedIn job pages and LinkedIn employer hiring posts.
  * Lane arms search whole-word method phrases, one ATS host per query, plus LinkedIn job pages.
  * A requisition-watch rotation (tenant registry + historical watch; `PRIORITY_EMPLOYER_DISCOVERY_BATCH_SIZE`, default 5) runs beside the inventory rotation.
* PR #123's `source-research-discovery.ts` now uses tenant-aware requisition parsing and detail-page detection. It rejects a registered tenant owned by a different employer, searches the recruiting tenant instead of the marketing domain, and drops parentheses.
* `/admin/sources` has a per-source "Verify individual requisitions" scope, a verification-only switch and path prefixes. The task list explains what a verification task does and does not mean.

## 4. Before/after on the fixed evaluation set

The set, `src/lib/pipeline/eval/official-posting-eval-set.json`, has 89 rows and 86 distinct identifiable roles. It includes:
* the 73 screenshot leads;
* 10 gap-review roles;
* 4 roles from the September 25 catalog;
* 2 labelled synthetic pattern cases (a J&J-style generic Technology Co-op, and a requisition on the real Northeastern-only board token);
* 14 labelled URL pairs;
* 3 known approved records;
* 6 misleading-tenant traps.

**Page bodies are synthetic reconstructions of the dated officer notes.** "Script shell" marks a page that research found client-rendered. Run it with `npm run verify:eval`.

| Metric | Before (PR #123 head) | After (every eval tenant governed) | After (documented production sources) |
|---|---|---|---|
| Distinct roles reachable by any scheduled query (title-level upper bound) | 42/86 (49%) | 70/86 (81%) | 70/86 |
| … reachable **without** employer-named queries (generalization) | 13/86 (15%) | 24/86 (28%) | 24/86 |
| Correct requisition ID from the URL (57 labelled) | 29/57 (51%) | 57/57 (100%)* | 57/57* |
| Misleading-tenant traps attributed from the URL alone | 3/6 | 0/6 | 0/6 |
| Employer attribution precision over all 68 known URLs | 36/37 (97%) | 66/66 (100%) | 66/66 |
| Duplicate decisions correct (14 pairs; 0 wrong merges after) | 11/14 | 14/14 | 14/14 |
| Known approved records caught before fetch | n/a | 3/3 | 3/3 |
| Evidence-backed decisions (review, closed, excluded, duplicate) | 0/68 | 42/68 (62%) | 3/68 (4%) |
| Distinct candidates reaching officer review | 0 | 26 | **0** |
| False "open" claims | 0 | 0 | 0 |
| Rotation days until an employer or lane is first searched (median) | 42 | 11 | 11 |

\* In-sample: the tenant registry and the parser were written from these URLs. The out-of-sample signal is the employer-agnostic row (13 → 24).

**Gate precision on readable synthetic pages (after):** degree 31/31, institution 5/5, work authorization 14/14, continued enrollment 19/19, academic credit 2/2.

The first run was lower: degree 28/29, institution 3/6, continued enrollment 14/16. That run found:
* two real extractor gaps, now fixed: "enrolled in a relevant master's program" and "at an Indiana college";
* five labelling errors in the set, now corrected.

Because the texts are paraphrases, re-measure gate precision on captured snapshots during the dry run.

**Time from discovery to officer review.** Before, a role discovered by broad search never generated a task. After, a governed, Apply-visible requisition generates a task in the same cycle it is discovered. The expected wait is therefore the rotation delay: up to 11 days for requisition-watch employers and lanes, and up to 36 days for the rest of the inventory. That is modelled, not measured.

### Failures by cause, after (every eval tenant governed)

| Cause | Rows |
|---|---|
| reached review (26) | S01 S04 S07 S09 S10 S16 S18 S21 S23 S24 S30 S34 S36 S43 S48 S50 S54 S55 S60 S61 S67 G1 G4 G5 G6 C2 |
| script-only ATS page (22) | S02 S03 S06 S20 S22 S27 S29 S31 S33 S38 S42 S46 S47 S49 S57 S64 S73 G2 G3 G7 G8 C1 |
| closed on employer page (7) | S08 S11 S56 S71 S72 G9 G10 |
| gate excluded (6) | S12 (undergraduate-only, generic title), S13, S15 (Roche QR&E), S39 (Kyowa Kirin), C3 (IBRI bioinformatics), P2 (Northeastern-only board) |
| duplicate of approved record (3) | S14 S26 S68 |
| employer not scheduled; title lacks every method phrase (15) | S19 S28 S32 S35 S37 S40 S41 S44 S53 S58 S62 S63 S69 S70 C4 |
| no employer requisition known (6) | S05 S17 S25 S65 S66 P1 |
| query constraints unsatisfiable (1) | S51 "R&D Lab Analyst": no intern/co-op word in the title |
| not identifiable (3) | S45 (past cycle), S52, S59 (truncated) |

The MD Anderson rows (S34 S43 S60 S61 S67) reach review with `recent_graduate_only` and `must_not_be_enrolled` quoted. That distinguishes them from enrolled-student roles, and the officer decides on the special view. **Unresolved after this work:** the 22 client-rendered requisitions, the 15 unscheduled or unmatched employers, the 6 roles without a known requisition, and S51.

## 5. Can the providers actually cover these roles?

* **Search (Brave).** Titles are reachable for 81% of roles in principle, but that is an upper bound. Ranking, the top 5 results per query, and whether Brave honours `OR` exactly as modelled are all untested. Brave's operators are documented as experimental. The Search plan costs $5 per 1,000 requests with $5 of monthly credit and 50 queries/s. Storing results requires a plan that **explicitly grants storage rights**; the standard Search plan page does not state them. `BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED` must stay false until the subscription terms say otherwise. Sources: [plans](https://brave.com/search/api/), [operators](https://api-dashboard.search.brave.com/documentation/resources/search-operators), [query limits](https://api-dashboard.search.brave.com/api-reference/web/search/post), [rate limiting](https://api-dashboard.search.brave.com/documentation/guides/rate-limiting).
* **Governed feeds.** They cover none of the 35 evaluation tenants today (F11). The highest-yield sources to review are tenant hosts that already recur in the set:
  * `www.careers.jnj.com` (6 roles; readable without scripts in the September research);
  * `jobs.sanofi.com` (6);
  * `gilead.wd1.myworkdayjobs.com` and `gilead.yello.co` (10 together; Yello pages were readable, Workday was not);
  * `jobs.mdanderson.org` (5);
  * the IBRI PrismHR host (3);
  * the Phenom hosts for Merck, Danaher, Thermo Fisher and Labcorp;
  * Nanopath, BillionToOne and Kyowa Kirin Greenhouse boards. These can use the existing Greenhouse feed connector, with no page verification needed.
* **Workday.** It needs a rendering tier (Scrapling, already in the repo; enable per the tooling policy) or officer browser checks. This change does not use Workday's private JSON endpoints.

## 6. Cost and rate limits for daily operation

| Stage | Per day (defaults) | Notes |
|---|---|---|
| Requisition-watch employers | 5 × ~6.6 ≈ 33 queries | 52 employers, 11-day cycle |
| Inventory employers | 5 × ~5.0 ≈ 25 queries | 178 employers, 36-day cycle |
| Scientific lane | 1 × ~7.8 ≈ 8 queries | 11 lanes, 11-day cycle |
| Exact-role research (PR #123) | 3 × 2 = 6 queries | |
| **Search total** | **≈ 72 queries**, versus 36 before | ≈ 2,160 per month, about $10.80 before the $5 credit (about $5.80 after); serial 1.1 s spacing adds about 80 s |
| Verification | ≤ 5 page fetches plus ≤ 5 feed lookups | Free; ≤ 5 × (2 s spacing + ≤ 15 s timeout); Scrapling adds up to 45 s per shell page when enabled |

The Vercel cron has a 300 s limit. Ingestion, 80–120 s of search and worst-case verification could approach it. Enable verification first in the GitHub Actions recovery cycle or as the manual worker, and watch `pipeline_cycles` durations before adding it to the Vercel cron.

## 7. Failure and recovery

* **Provider 429 or 5xx.** The discovery errors are counted, the cycle ends `partial` and the leads already archived stay. Discovery re-runs the next day.
* **Host 401, 403 or 429.** The row is recorded as `blocked`, the host is not retried in that run, and no bypass is attempted.
* **Script shell.** The row is recorded `unresolved_page` with the reason. An officer checks it in a browser or enables Scrapling for that governed source.
* **Snapshot upload fails.** That candidate errors and nothing is recorded. It is retried on the next run because nothing marked it verified.
* **RPC fails.** The error is reported and the snapshot object is orphaned but harmless (a content-addressed path).
* **Retries.** The same run and content produce the same `verification_key`, so a retry does nothing twice. A new day adds a new evidence row, but never a second open task for the same requisition.
* **Rechecks.** A requisition is re-verified at most every 7 days.
* **Rollback.** Unset `POSTING_VERIFICATION_ENABLED`. The table is append-only evidence; leave it. Clear a source's scope in `/admin/sources`.

## 8. Migration and deployment order

1. Apply PR #123's `20260926120000_discovery_review_candidate_gate.sql`.
2. Apply `20260927090000_official_posting_verification.sql`. Confirm `database_release_health` reports `official_posting_verification`.
3. Deploy the code with `POSTING_VERIFICATION_ENABLED` unset.
4. In `/admin/sources`, register and review one server-rendered tenant (for example J&J). Record its terms and robots review, set the verification scope to its host and `/en/jobs/`, and consider "verification only".
5. Run `VERIFICATION_DRY_RUN=true POSTING_VERIFICATION_BATCH_SIZE=3 npm run verify:worker`. Inspect the decisions and page states, and re-measure gate precision on the real text.
6. Run once without dry run, then check `posting_verifications` and the single task.
7. Only then set `POSTING_VERIFICATION_ENABLED=true`, starting in the GitHub Actions cycle.

Search stays off until provider storage rights are confirmed in writing and a bounded `npm run discovery:worker` run has been inspected.
