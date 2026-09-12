# Discovery pipeline: historical design

> Do not implement the table names or deployment steps below. This file preserves
> the original design and test findings only. The integrated contract is
> `pipeline-integration.md`; it reuses migrations 0001-0007 and migration 0011.
> Parallel SQL remains non-executable under `supabase/proposals`.

Seven stages. Each writes to its own table, so any stage can be re-run without
re-running the ones before it. Nothing publishes without a human.

```
sources ──▶ fetch ──▶ raw_documents ──▶ classify ──▶ candidates
                │                                        │
           (304? stop)                              (kept=false? stop,
                                                     with a stated reason)
                                                         │
                                                         ▼
                                          extract ──▶ extractions
                                                         │
                                              bind evidence in CODE
                                                         │
                                    ┌────────────────────┴────────────┐
                                    ▼                                 ▼
                            evidence_ok=true                  evidence_ok=false
                                    │                                 │
                                    └────────▶ review_queue ◀─────────┘
                                                    │
                                            OFFICER DECIDES
                                                    │
                                                    ▼
                                        published_opportunities
                                                    │
                                        public workbook ──▶ npm run publish-data
```

## Stage by stage

**1. Schedule.** `sources_due()` returns at most 25 sources whose poll interval has
elapsed. Interval depends on whether today falls inside that employer's recruiting
window — the calendar you already maintain becomes the crawler's schedule. NIH gets
polled daily from mid-November to mid-February and monthly otherwise. A source with
5 consecutive errors is skipped until an officer resets it.

**2. Fetch.** Conditional GET with stored ETag and Last-Modified. A 304 costs one
request and ends the stage. Content is hashed; an unchanged hash also ends the stage.
Sequential, 1–2 req/s, honest User-Agent naming the club and a contact address.
Stranger-submitted URLs go through `lib/safe-fetch.ts` (SSRF guarded).

**3. Store raw.** Text goes in `raw_documents`, keyed by content hash. This is what
evidence quotes are verified against, so it must be immutable. Without it,
provenance is a claim rather than a check.

**4. Classify.** `lib/classify.ts`, deterministic, no model, free. Drops roughly 90%
on title exclusions, missing lanes, or missing internship signal. Every drop records
its reason and its partial analysis, so an officer can ask "why didn't we see X?"
and get an answer. Stores `taxonomy_version` so records can be reclassified when the
taxonomy changes.

**5. Extract.** Only survivors reach a model. 27 fields, structured output, one call
per posting. Approximately 4k input tokens each.

**6. Bind evidence.** `lib/evidence.ts` asserts every quote is a literal substring of
the stored raw text. Failures do not discard the record — they flag it for a human
and set `evidence_ok=false`. This is also the anti-injection control: a poisoned
posting cannot make the model invent a requirement that isn't in the text.

**7. Review and publish.** Everything lands in `review_queue`. The officer edits
`final_fields`, sets `final_bucket` and `final_reason`, and approves. Publishing
copies to `published_opportunities`, then the public workbook, then
`npm run publish-data`, whose validator independently refuses records missing a
source, with a malformed date, or carrying a private-field header.

## What this fixes from the audit

| Finding | Fix |
|---|---|
| Officers cannot review submissions in-app | `review_queue` with a single unified inbox for submissions and ingested candidates |
| Submissions absent from the weekly email | `review_queue` + `stale_published` views feed the digest |
| Undergrad scoring penalizes master's | Replaced by `graduate_stage` enum; ambiguity stays eligible as "Clarification required" |
| Greenhouse ingestion unscheduled | `sources_due()` + Supabase Cron, with the recruiting calendar setting cadence |
| Lanes conflated with functions | Separate `lanes`, `functions`, `methods` columns; ML-type lanes gated on biological context |
| AI approval risk | Extraction writes only to `extractions`; publishing reads only `review_queue.final_*` |

## What still needs improving

1. **Closure detection is weak.** A role that disappears from a board sets
   `closed_at`, but a page-based source that changes its layout looks the same as
   one that closed. Mitigation: `source_health.binding_failure_rate` and a zero-result
   alert, not automatic retirement.
2. **Duplicates across sources.** The same NIH role can appear via USAJOBS and the
   program page. Current dedupe is `(source, external_id)`, which does not catch this.
   Needs a normalized `(employer, title, year)` fuzzy key with officer confirmation.
3. **No backfill of retired roles.** Useful for next year's calendar; currently
   `retired_at` is set but nothing analyzes the history.
4. **The recruiting windows are hand-maintained.** They should eventually be derived
   from observed open/close dates in `candidates`, which the schema now supports.

## Recurring runs

Supabase Cron is the primary scheduler because GitHub documents that scheduled
workflow runs can be delayed or dropped under load — fine as a secondary heartbeat,
not as the source monitor.

```sql
-- every 6 hours: fetch + classify. Cheap, no model calls.
select cron.schedule('discover', '0 */6 * * *', $$
  select net.http_post(
    url    := 'https://YOUR-PROJECT.functions.supabase.co/discover',
    headers:= jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret')),
    body   := '{}'::jsonb, timeout_milliseconds := 30000
  );
$$);

-- daily 07:00 PT: extract whatever is classified but not yet extracted
select cron.schedule('extract', '0 14 * * *', $$ ... $$);

-- Mondays 08:00 PT: officer digest — new candidates, stale records, source health
select cron.schedule('digest', '0 15 * * 1', $$ ... $$);
```

Each endpoint requires a `CRON_SECRET` bearer token, is idempotent, and holds a
Postgres advisory lock so overlapping runs cannot double-insert.

## Cost

~300 postings/week reach the pre-filter. ~40 survive to extraction at ~4k tokens
each: roughly 160k tokens/week. Pennies on a mid-tier model, and inside a single
provider's free tier used normally. The gateway is for failover, not for quota.

---

# Implementation status

| Component | File | Tests |
|---|---|---|
| Taxonomy | `taxonomy/lanes.yaml` | — |
| Classifier | `lib/classify.ts` | 32 |
| Connectors (Greenhouse, Ashby, Lever, USAJOBS, page) | `lib/connectors/` | 61 |
| Orchestration worker | `lib/worker.ts` | 37 |
| Eval harness + golden set | `lib/eval/score.ts`, `eval/golden-set.json` | 40 |
| Evidence binding | `lib/evidence.ts` | (in security kit) |
| Database schema | `supabase/migrations/` | — |

`npm run test:pipeline` runs 497 checks across fifteen offline suites. No network,
no API keys, and no database are required.

## Ports, so nothing is locked in

`runSource()` takes three injected dependencies:

- **`Store`** — implement against Supabase; the tests use an in-memory fake with
  the same shape.
- **`Fetcher`** — the real one wraps `lib/safe-fetch.ts` (SSRF guarded, conditional
  GET); tests use a fixture-backed fake.
- **`ExtractionModel`** — any gateway or SDK. Swapping providers touches one file.

This is why the whole pipeline is testable with no credentials, and why an
OmniRoute/Bifrost/Vercel-gateway decision does not require rewriting the worker.

## The eval gate

`DEFAULT_GATE` in `lib/eval/score.ts`:

| Threshold | Value | Why |
|---|---|---|
| Critical-field precision | 0.95 | Wrong eligibility costs a student weeks |
| Overall precision | 0.90 | |
| Overall recall | 0.70 | Deliberately lower — an omission is an officer's job, a fabrication is a student's problem |
| Fabrications | 0 | Asserting something the posting never said is never acceptable |

Critical fields: masters_eligibility, work_authorization, gpa_requirement,
enrollment_rule, return_rule, deadline.

**Run the gate before any model or prompt change ships.** Verified against four
adversarial models: perfect (passes), fabricator (caught by binding),
misattributor — real quote on the wrong field (caught only by the golden set,
which is why both layers exist), wrong-number (caught by critical-field
precision), and lazy all-Unknown (caught by recall).

## Before first production run

1. Recheck each connector against current vendor docs during source onboarding.
   The contracts were last checked on 2026-09-10; a fixture is not proof that a
   specific employer board identifier is valid.
2. Get a USAJOBS API key and registration email and keep both in server-only
   secrets. The canonical runner injects them only into `createUsaJobsFetcher(...)`.
   The general `safeFetch` path intentionally never accepts credentials.
3. The extraction contract now has 33 hand-labelled synthetic cases across all
   ten lanes and every extraction field. Build a separate corpus of at least 30
   real, officer-labelled postings before using its scores to gate a model in
   production; synthetic coverage proves behavior, not real-world validity.
4. Validate the Supabase `Store` against the preview database and its RLS rules.
5. Run with `model: null` first — classification only, no spend — and read the
   drop reasons. That tells you whether the taxonomy is right before you pay for
   a single token.

---

# Round 2: the loop closes

| Component | File | Tests |
|---|---|---|
| Supabase Store (real implementation of the port) | `lib/store-supabase.ts` | — (needs a live project) |
| Officer inbox API | `lib/inbox.ts` | covered by the 57-check publish suite |
| Weekly digest experiment | `lib/digest.ts` | covered by the 57-check publish suite |
| Publish bridge | `lib/publish-bridge.ts` | covered by the 57-check publish suite |

Current local matrix: `npm test` runs 497 application tests across 24 files;
`npm run test:pipeline` runs 497 pipeline checks across 15 suites.

## End-to-end verification performed

Bridge output was written into a real copy of the public workbook and passed
through the actual exporter (`scripts/extract-data.mjs` in the site repo):

```
bridge columns not found in the sheet: []
sheet columns the bridge does not fill: []
ok  3 opportunities (graduate 2, special 0, adjacent 1, excluded 0)
ok  release 2026-09-08-83e71e1b
```

The exporter's independent validation also caught a deliberately broken record
(an `adjacent` reason that did not explain the term mismatch) and refused to
write, leaving the previous `data.js` untouched. Two independent layers agreeing
is the point: the bridge validates before emitting, and the exporter validates
again before publishing.

## Closure detection, resolved

`markSeen()` closes candidates absent from an ATS response but **never** for
`page` sources, where absence means a parse failure rather than a closed role.
That was listed as an open problem in round 1.

## Officer edit rule

`reconcileEdits()` re-verifies edited fields against the stored source. An
officer may correct a value the model got wrong; when they do and the old quote
no longer supports the new value, the quote is dropped rather than left pointing
at unrelated text. The officer's value is preserved, uncited.

**Documented limit, proven by a test:** if an officer changes a value but the
old quote still binds *literally* (e.g. "3.5 required" attached to a real
sentence saying 3.0), binding cannot catch it. Only the eval golden set can.
This is the same misattribution class found in round 1, and it is why both
layers exist.

## Derived next steps

`buildNextStep()` composes the recommendation from what the evidence is missing,
never from a model:

| Evidence state | Next step |
|---|---|
| Eligibility unknown | "ask recruiting whether master's students are eligible" |
| Authorization unknown | "confirm the sponsorship policy" |
| Deadline unknown | "check the live posting for a deadline" |
| All known | "Requirements are stated. Apply by {deadline}." |
| Bucket = special | "Confirm you can meet the published structural requirement" |
| Bucket = excluded | "Kept as evidence only. Not an application target." |

## Batch behaviour

`buildWorkbookRows()` emits **nothing** when any record fails validation. A
half-valid workbook is worse than no workbook: it publishes some records while
silently dropping others, and no one notices which.

## Still open

1. **Cross-source duplicates.** NIH via USAJOBS and via the program page are
   still two records. Needs a fuzzy `(employer, title, year)` key with officer
   confirmation.
2. **Retired-role history is unanalyzed.** `closed_at` is now set correctly, so
   deriving next year's recruiting windows from observation is possible but
   unbuilt.
3. **`SupabaseStore` is untested against a live project.** The port and its
   queries are written; the fake proves the contract, not the SQL.

---

# Round 3: applying the architecture review

The deep-research review's highest-priority finding was that precision-only
evaluation hides false negatives. It was right, and it found a real one.

## Recall benchmark added (`eval/must-not-miss.json`, `tests/recall.test.ts`)

Twelve adversarial cases, most describing the work without the obvious lane word
— ctDNA without "cancer", genome-wide CRISPR screens without "genomics", Visium
and Xenium without "spatial".

**First run: 11/12. One real false negative.** A clinical variant-curation role
in a CLIA lab was dropped entirely with "no scientific lane matched". Cause:
`genomics` and `diagnostics` each held exactly one supporting hit ("variant
annotation", "CLIA"), and the precision-first rule requires two before a lane
qualifies. Two independent weak signals were discarded.

Two fixes, in order of preference:

1. **Vocabulary** (the better fix): added `variant interpretation`,
   `variant curation`, `sequence variant`, `acmg`, `mageck`, `pooled screen` to
   genomics; `clinical evidence`, `acmg` to diagnostics. That alone resolved the
   case on real terms.
2. **Cross-lane corroboration** (the safety net for the next one): when two
   different lanes each hold a single supporting hit *and* a biological context
   term is present, keep the record and flag `corroboratedOnly` so officers
   review it more carefully. Verified that the same shape without biological
   context stays dropped.

**Result: 12/12 recall, and all eight false-positive cases still rejected.**
Both directions are now permanent gates, so a future taxonomy edit cannot trade
one for the other silently.

## Decision-flip error rate added

From the review: "Misreading compensation by $1 is not equivalent to incorrectly
deciding that an MS student is ineligible." The eval now separates quality
defects from decision defects across eight decision-bearing fields.

| Direction | Meaning | Cost |
|---|---|---|
| `eligible_to_ineligible` | invented or hardened a restriction | worst — suppresses a valid application |
| `ineligible_to_eligible` | lost or softened a stated restriction | wastes weeks of effort |
| `deadline_lost` / `deadline_invented` | timing changed | missed window, or false urgency |

`maxDecisionFlips: 0` in the gate.

**A design note worth keeping:** the first implementation tried to regex-detect
whether a value was "restrictive", and failed on `US citizens or permanent
residents` — a hard restriction with no "only" in it. The fix was to stop trying:
*any* error on a decision-bearing field is a flip, and the pattern now only
labels direction. Simpler and safer.

## Where this work agrees with the review

Already built before the review arrived: evidence-span requirement with a
deterministic check, immutable content-hashed provenance, change detection ahead
of parsing and inference, first-class ATS adapters, model output never
overwriting authoritative data, deadline-aware source scheduling, and acquisition
workers holding no credentials.

## Where the review should update this project

Genuinely missing, in the review's own priority order:

1. **Hybrid retrieval (pgvector + Postgres FTS).** There is no semantic layer at
   all — matching is purely lexical against the taxonomy. The adversarial set
   passed on vocabulary breadth, which does not scale to phrasings nobody
   anticipated. This is the largest real gap.
2. **Query portfolios.** `buildQueries()` emits correlated queries per lane —
   precisely the anti-pattern the review names ("ten highly correlated Boolean
   queries are one effective lane, not ten"). Should score marginal unique yield.
3. **Reject audit sampling.** The must-not-miss set is a fixed benchmark; it does
   not sample real weekly rejects. `candidates.drop_reason` is already stored, so
   the sampling query is small.
4. **Positive-unlabeled learning and hard negatives** before any LightGBM ranker.
5. **Capture-recapture coverage estimation** across lanes.
6. **Expected-opportunity records.** `closed_at` is now recorded correctly, so
   deriving windows from observed history is possible but unbuilt.

## One correction to the review

The review recommends LiteLLM as the production gateway on maturity grounds and
does not mention that LiteLLM suffered a **PyPI supply-chain compromise in March
2026** (malicious versions 1.82.7 and 1.82.8, roughly 40 minutes live, CloudSEK
reporting 2,500+ organizations affected). That does not overturn the choice —
maturity and release cadence still favour it — but it changes the *adoption
procedure*: pin exact versions, enforce the dependency cooldown in
`renovate.json`, and keep the gateway container holding LLM keys only. Verify
independently before acting on either the review's recommendation or this note.

---

# Round 4: guarding against the token-compression stack

Investigating the Claude Code tooling (Caveman, Headroom, OmniRoute, RTK)
surfaced a concrete threat to this pipeline. All of them rewrite text somewhere
between you and the model. Evidence binding requires quotes to be **literal
substrings of the stored `raw_text`**. If anything compresses the posting on the
wire, the model quotes what it was shown, binding checks against what we stored,
and **every field fails**.

The dangerous part is not the failure. It is that the symptom —
"extraction quality collapsed" — is indistinguishable from a model regression.
The natural response is to swap models, which fixes nothing and costs days.

## `lib/integrity.ts` (38 tests)

**Active detector.** A sentinel line is prepended to the request, outside the
untrusted-posting fence, and echoed back through a schema field. It is written
to be compression-hostile: filler words a compressor strips, exact spacing, a
trailing marker. Tested against a simulated compressor and a truncating proxy.
The echo field is deleted before storage and never published.

**Passive detector.** `diagnose()` reads the *shape* of binding failures across
a run and separates three causes that need opposite responses:

| Pattern | Verdict | Response |
|---|---|---|
| Near-total failure, every source at once | `transit_corruption` | Disable compression for the worker. **Do not swap models.** |
| One source failing, others healthy | `source_drift` | That page or endpoint changed; check the parser |
| Partial, scattered failure everywhere | `model_quality` | Run the golden set before changing anything |

It refuses to diagnose below five observations.

**Cost:** a few tokens per extraction. Worth it to turn a multi-day
misdiagnosis into a one-line error message naming the remedy.

## `lib/portfolio.ts` — query portfolios

The review's criticism of `buildQueries()` was exact: "Ten highly correlated
Boolean queries are one effective lane, not ten." The old function emitted
`single-cell intern`, `single-cell internship`, `single cell intern` — three
queries returning nearly identical sets, counted as three lanes of coverage.

`buildPortfolio()` selects greedily by **marginal unique yield per unit cost**.
Near-duplicates earn nothing and are rejected with a stated reason naming what
they overlap. Verified: full coverage retained at lower cost, and a broad
expensive query correctly beats a cheap useless one.

**A test-quality note worth keeping.** The first version of this demonstration
matched any token over three characters, so "intern" swept the whole corpus and
one query appeared to cover everything. The algorithm was right; the test data
was worthless. The simulation now excludes generic terms, and the portfolio
correctly keeps four distinct queries and drops exactly one duplicate.

## Reject audit and coverage estimation

`sampleForAudit()` samples the four populations the review names —
high-confidence rejects, low-confidence rejects, single-lane finds, zero-yield
sources — each with a plain-language reason for why that population matters.
Sampling is **deterministic**, so two officers reviewing the same week see the
same records.

`estimateCoverage()` implements a Chapman-corrected capture-recapture estimate
across two lanes, and attaches a caveat to every result: discovery lanes share
sources and vocabulary, so the independence assumption is false and this is an
optimistic lower bound, never a coverage guarantee.

## Operational rule

If you run Headroom, Caveman, RTK, or any gateway with prompt compression
enabled: **exempt the extraction worker's traffic**. The guard will tell you if
you forget, but it cannot repair a run that already happened.


---

# Round 5: hybrid retrieval

The review's #2 item and the gap I named as largest. Built with the same port
pattern as the model and store, so the embedding provider is a config choice.

## What is verified, and what is not

**Verified offline (57 tests):** the BM25 implementation, cosine, reciprocal
rank fusion, Recall@k / Precision@k / NDCG@k / MRR, graceful degradation, and
that the benchmark correctly *rejects* a useless embedder rather than shipping
it because it is new technology.

**Not verified:** whether semantic retrieval improves recall on the real corpus.
That is corpus-dependent and needs a real embedder. `lib/eval/retrieval-bench.ts`
exists to answer it with a number. Do not deploy the embedding column until
`compare()` says it beats lexical on the must-not-miss set.

## The finding that justifies the whole thing

Running BM25 over the real must-not-miss corpus with the query
`single cell RNA sequencing analysis`:

```
3.03  mnm-10-vaccine-immuno      matched: cell, sequenc   (22 tokens)
2.14  mnm-02-crispr-screen        matched: cell, analysi   (29 tokens)
1.62  mnm-08-ml-at-biotech        matched: sequenc         (31 tokens)
```

The actual single-cell posting is **not in the top three**. It writes
`scRNA-seq` — one token matching none of the query's — while the vaccine
posting's "T cell receptor sequencing" matches `cell` and `sequenc` in a short
document, which BM25's length normalisation rewards.

This is not a bug. It is exactly how lexical retrieval fails on compound domain
terms, measured on our own data, and it is the strongest available argument for
the embedding arm. It is now a permanent test, so if a future change fixes it
lexically, the test will say so.

## Three real bugs the benchmark exposed

1. **`tokenize()` dropped single characters**, losing `R` — a programming
   language in this domain, present in a large share of postings. Fixed with an
   explicit allowlist rather than lowering the threshold for every stray letter.
2. **`vectorSearch()` returned the entire corpus ranked.** Fusion then dragged
   every irrelevant document into the results and precision@10 fell 33 points.
   Fixed with a similarity floor (default 0.25). Semantic search must be a
   filter, not a re-ordering of everything.
3. **`compare()` recommended shipping on recall alone.** A retrieval change that
   raises recall while destroying precision floods the officer queue, and every
   extra irrelevant result costs an officer minute. Precision regression now
   blocks the recommendation with a suggested remedy.

Two of my own test premises were also wrong and were fixed rather than
accommodated: a "paraphrase" case whose document actually contained the query
word, and an assertion that lexical retrieval would rank the right posting
first.

## Deployment

`supabase/migrations/20260909000000_retrieval.sql` adds pgvector, a weighted
generated `tsvector` (title A, employer B, body C), an HNSW cosine index, and a
`hybrid_search()` function that mirrors the TypeScript fusion exactly — including
degrading to lexical-only when `query_vector` is null — so the benchmark and
production cannot silently diverge.

Order of operations: backfill embeddings, then build the HNSW index, then run
the benchmark, then decide.

---

# Round 6: the officer review interface

Everything still outstanding from the architecture review — positive-unlabeled
learning, hard-negative mining, a LightGBM ranker — gates behind having labels.
Labels come from officers making decisions. So the review interface is not a
nice-to-have at the end; it is the mechanism that unblocks the rest, and it was
item #1 in the original build order.

## `lib/highlight.ts` (32 tests)

The hard part is placing citations correctly. An officer verifies a claim by
seeing the sentence it came from, in place. A highlight that lands a few
characters off is worse than no highlight, because it looks authoritative.

Three problems solved and tested:

1. **Offset space.** Offsets from `lib/evidence.ts` index into *normalized*
   text; display needs the original with its line breaks. `buildOffsetMap()`
   maps between them. A test deliberately buries the target after ~40 collapsed
   whitespace runs, because a naive implementation drifts by exactly the number
   of collapsed characters — so the first highlight looks fine and the last one
   is badly wrong.
2. **Overlaps.** Two fields can legitimately cite overlapping spans. A boundary
   sweep produces shared segments instead of duplicating or dropping the
   overlap. Tests assert that concatenating all segments reproduces the input
   byte-for-byte.
3. **Uncited values.** A value the officer typed has no offsets and must look
   visibly different from one carrying evidence.

`normalizeForOffsets()` is asserted equal to `normalize()` in `lib/evidence.ts`
across four samples, because if those ever diverge every highlight silently
shifts.

## Visual verification

`ui/review-preview.html` is generated by running the real segmentation logic
over a real posting, so the screenshot reflects actual output rather than
hand-written markup. Rendered and inspected at **1440 / 768 / 390 / 320**.

Confirmed by eye: all seven highlights land exactly on the cited spans, the
uncited field sorts to the top with a red rule and a warning, "Unknown" fields
are visually distinct from unverified assertions, and no console errors.

**One defect found and fixed:** 44px horizontal overflow at 390px, caused by the
fixed-width counts strip in the header. Now clean at all four widths.

## `ui/ReviewCard.tsx`

Enforces client-side what `lib/inbox.ts` enforces server-side, so the officer
sees the rule before the request is rejected:

- approving requires an explicit bucket and a reason of 20+ characters (40+ for
  excluded)
- rejecting requires a note of 10+ characters
- **editing a value drops its citation** — the officer's text is kept, the quote
  is not, because it no longer supports what the field says
- injection-flagged postings carry a banner naming the technique detected
- unverified assertions sort above verified ones; "Unknown" is not an error

Hovering a field highlights its span in the source, and hovering a span names
the fields citing it.

## What this unblocks

Every officer decision is a label. Once a few hundred exist:

- **Hard negatives** — the rejects that scored highest are the informative
  training examples, not random irrelevant jobs
- **Positive-unlabeled learning** — a record never surfaced is not a negative,
  and `candidates.drop_reason` already distinguishes the two
- **Calibration** — "among records the system scored 0.8–0.9, what fraction did
  officers approve?" is answerable directly from `review_queue`
- **LightGBM ranker** — with a temporal split, since programs recur and a random
  split would leak 2026 postings into a 2027 test set

None of that should start before the labels exist. The interface is the gate.


---

# Round 7: self-escalating fetch

Goal: never be interrupted to fix a source again. The fetch layer now escalates
itself through three tiers and records what it did.

| Tier | Fetcher | Cost | When |
|---|---|---|---|
| 0 | conditional GET | free | default; most weeks a 304 |
| 1 | Scrapling | free, local | JS rendering, adaptive selectors |
| 2 | ScrapeGraphAI `scrape` | paid | what tier 1 cannot reach |

## The constraint that shapes the design

**Every tier returns raw text. None of them extracts.**

ScrapeGraphAI's `scrape` (page to markdown) is wired in. Its `extract` (page to
structured JSON) is deliberately not. Extraction inside a remote API leaves
nothing on our side to verify a quote against, so "cited" would become a
vendor's assertion instead of a checked fact. Fetching is delegable; extraction
is the thing the whole product rests on.

A test asserts that every tier exposes `fetch` and none exposes `extract`, and
that a quote taken from any tier's output still binds literally.

## Behaviour (31 tests)

- **A 200 can still be useless.** JS shells, bot-check interstitials, login
  walls and access-denied pages are detected and escalate rather than being
  stored as content. Previously a React rewrite would have silently poisoned a
  source with an empty shell.
- **Escalation is sticky.** A source promoted to Scrapling starts there next
  run. Verified: tier 0 is not called again after it fails.
- **Cost decays.** After 8 consecutive clean runs a source demotes, so one bad
  week does not make it permanently expensive.
- **The paid tier has a hard budget cap.** Over budget it refuses and says
  `budget exhausted`, rather than skipping silently.
- **Every failure is recorded with its reason**, per tier, on the fetch row.

## Silent, but never invisible

Escalation happens without interrupting anyone, and `escalated_sources` feeds
the weekly digest. Officers see which sources degraded and what it is costing,
after the fact, instead of being paged at the time. Drift becomes a line item
rather than an outage.

The one case that still needs a human is every tier failing — and that error
names each thing that was tried and why.
