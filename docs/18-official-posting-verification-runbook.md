# Official-posting verification runbook

**Status: implemented, inactive.** Nothing runs until `POSTING_VERIFICATION_ENABLED=true` or someone runs `npm run verify:worker` by hand. For findings, evaluation and design, see [research/2026-09-27-official-posting-verification.md](research/2026-09-27-official-posting-verification.md).

## What it does

It takes a candidate employer URL from discovery leads or source research and turns it into one private, append-only `posting_verifications` row. When the employer page shows a distinct requisition with an Apply control, it also opens one private `source_new` review task. It never publishes, approves, edits `opportunities`, logs in, retries a refusal or bypasses robots and source restrictions. A search result or LinkedIn page is never evidence of an open job.

## Outcomes you will see

| Outcome | Meaning | Officer action |
|---|---|---|
| `review_candidate` | Governed employer page, requisition consistent, Apply visible in the stored text, no duplicate | Open the task. Confirm live Apply and every gate on the employer site, then create a private draft through the existing flow. |
| `duplicate_existing` | Same requisition already in `opportunities` or `source_postings` (locale, location path, tracking and trailing slash ignored) | None; the existing record is authoritative |
| `repeat_candidate` | Already sent to review | None |
| `closed` | Employer text says closed or filled, returns 404/410, or states a past deadline | Keep it archived; do not publish |
| `gate_excluded` | Quoted undergraduate-only, PhD-only or single-institution restriction, or a restricted board (Northeastern-only Flagship) | None, unless the quote is wrong |
| `rejected_attribution` | The URL's tenant belongs to another employer | Check the lead's employer |
| `rejected_title_mismatch` | The page is a different role | Search again by exact title |
| `rejected_not_requisition` | LinkedIn, an aggregator, or a board or search page | Follow the Apply link to the employer |
| `unresolved_governance` | No reviewed source scopes this tenant | Consider registering the tenant (see below) |
| `unresolved_page` | Script-only shell, blocked, error page, redirected away, or readable but no Apply control | Check in a browser. For Workday, enable Scrapling for the reviewed source. |
| `unresolved_attribution` | Parent or shared tenant (Danaher, ORISE, Gilead for Kite) and the page does not name the lead employer | Verify ownership manually |
| `unresolved_conflict` | The URL requisition differs from the page, or a redirect landed on another requisition | Treat as two requisitions until proven otherwise |

Every gate has a value and either a quote copied from the stored page or `not_stated` / `unknown`. `not_stated` means the readable page did not mention the gate. It is not proof that the restriction does not exist.

## Allowing verification for a tenant

1. `/admin/sources` → add the employer's recruiting host as a source. Use the individual careers host, for example `https://www.careers.jnj.com/en/jobs/`, not the marketing site. For a Greenhouse, Lever or Ashby board, add the board itself: its feed then answers verification with no page fetch.
2. Read the host's terms and robots.txt, then tick both reviews. Enabling a source still requires both reviews; Northeastern-only boards cannot be enabled.
3. Under the source, tick **Verify individual requisitions** and set **path prefixes** (for example `/en/jobs/`). Tick **Verification only** when the careers landing page should not be list-fetched every day; the scheduler skips those sources.
4. For Workday or other script-rendered hosts, verification records `script_only` unless the approved Scrapling tier is installed and `PIPELINE_SCRAPLING_ENABLED=true`. The verification renderer now records its final URL and reported redirect history. Only a matching requisition on the reviewed HTTPS host can reach review; legacy HTML without URL metadata is archived as unresolved. Browser rendering may follow a redirect before that check, so the rendered body is discarded if it leaves the reviewed host. Stealth, CAPTCHA solving and proxy rotation remain disallowed (`config/ai-tooling.json`).

Scopes require an HTTPS recruiting URL, a matching tenant key, and at least one specific job path prefix. An older host-only scope is intentionally inactive until an officer saves it again. A shared ATS hostname never authorizes every employer on that hostname. A governance gap is retried on the next cycle after a source is approved.

## Running it

```bash
# Look only: fetches governed pages, writes nothing.
VERIFICATION_DRY_RUN=true POSTING_VERIFICATION_BATCH_SIZE=3 npm run verify:worker

# Record evidence (still private; at most one task per requisition).
POSTING_VERIFICATION_BATCH_SIZE=5 npm run verify:worker

# Offline before/after replay on the fixed evaluation set.
npm run verify:eval            # EVAL_ROWS=true for per-row causes
```

In the daily cycle, `POSTING_VERIFICATION_ENABLED=true` runs verification after discovery. `POSTING_VERIFICATION_BATCH_SIZE` defaults to 5, with a maximum of 20. The summary is stored in `pipeline_cycles.discovery_json.verification`. Enable it in the GitHub Actions recovery cycle first: the Vercel cron has a 300-second limit.

Related discovery settings:
* `PRIORITY_EMPLOYER_DISCOVERY_BATCH_SIZE` (0–8, default 5 in the cycle) sets how many requisition-watch employers are searched per day. They come from the tenant registry plus the historical watch.
* `EMPLOYER_DISCOVERY_BATCH_SIZE` (1–5) rotates the alumni inventory.

## Monitoring

* In `pipeline_cycles.discovery_json.verification`, look at `considered`, `fetched`, `recorded`, `reviewTasks`, `outcomes`, `governanceGaps` and `errors`. A run with `fetched = 0` and every outcome `unresolved_governance` means no tenant has been reviewed yet. It did no verification; treat it as a gap, not a success.
* Useful SQL, as an officer:
  ```sql
  select outcome, page_state, count(*) from posting_verifications
  where created_at > now() - interval '7 days' group by 1, 2 order by 3 desc;

  select tenant_key, count(*) from posting_verifications
  where governance_status = 'no_governed_source' group by 1 order by 2 desc;
  ```
  The second query ranks the tenants whose review would unlock the most verification.
* Recall: add each officer-found miss to `src/lib/pipeline/eval/official-posting-eval-set.json` with its employer URL and labels, then re-run `npm run verify:eval`. Keep the synthetic label on reconstructed pages.

## Limits and recovery

* At most 3 fetches per host per run, at least 2 seconds apart. A host that answers 401, 403 or 429 is not requested again in that run. The paid ScrapeGraph tier is never used for verification.
* Each requisition is rechecked at most every 7 days. Retries are idempotent (`verification_key`). The evidence table rejects updates and deletes.
* Private contact data is redacted from quotes and task notes. The raw snapshot stays in the private `source-payloads` bucket under `verification/`.
* To roll back, unset `POSTING_VERIFICATION_ENABLED` or clear a source's scope. Do not delete evidence.
