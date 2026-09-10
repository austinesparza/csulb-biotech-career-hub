# Integrated discovery and review pipeline

## Current contract

There is one source registry, one observation history, one officer queue, and one
public opportunity table. The automated extraction work adds evidence to that
system. It does not create a second publishing path.

| Responsibility | Canonical table or view |
|---|---|
| Source provenance | `source_records` |
| Approved machine-readable sources | `job_sources` |
| Fetch queue and history | `source_fetch_runs` |
| Private raw payload metadata | `source_payloads` |
| Current source posting | `source_postings` |
| Immutable normalized observation | `source_posting_versions` |
| Bound model output | `pipeline_extractions` |
| Officer work | `review_tasks` plus pending `opportunities` |
| Public records | `opportunities` through `public_opportunities` |
| Public suggestions | `user_submissions` |

The SQL proposals under `supabase/proposals` are retained for design history and
are not run by the migration tool.

## Event flow

1. An officer approves a `job_sources` record only after terms and robots review.
   Sources are disabled by default.
2. The existing connector and persistence bridge create a fetch run, store the
   private payload, upsert the source posting, append a posting version, and open
   a review task in one transaction.
3. The deterministic classifier reads the normalized posting text. It keeps
   scientific lanes, job functions, and methods separate. Ambiguous MSc access
   remains unresolved rather than being labelled eligible.
4. An extraction model may process the immutable posting version. Every asserted
   field includes a quote. Code checks each quote against the exact normalized
   text stored in that version.
5. `pending_pipeline_extractions` selects work for an exact schema and prompt
   version. A prompt upgrade can therefore reprocess the same immutable source
   without deleting history.
6. `persist_pipeline_extraction` stores the output and attaches it to the existing
   source-posting review task. Extraction neither creates a parallel task type
   nor changes public opportunity fields.
7. `/admin/review` shows the source link, extracted values, quotes, and original
   text. The officer chooses the audience and MSc stage.
8. `decide_opportunity_review` changes the opportunity, resolves its linked
   source-posting and opportunity tasks, records the officer and final decision,
   and optionally exposes the company in one transaction.
9. The public view admits only approved, public-safe, open, MSc-accessible records.

## Classification ownership

`pipeline/classify.ts` is the canonical subject and eligibility classifier.
`relevance.ts` only orders already-created review records by practical factors
such as deadline, compensation, location, and whether MSc eligibility is stated.
It does not decide inclusion. `focusAreas.ts` is a legacy display adapter for the
single `focus_area` column; new structured records use `scientific_lanes`,
`job_functions`, and `methods`.

## Digest ownership

`scripts/review-digest.mjs` is the production entrypoint. It owns the Supabase
query, combined opportunity/submission reminder, configuration checks, Gmail
transport, HTML escaping, and scheduled workflow. `pipeline/digest.ts` remains a
pure formatter experiment for future source-health, evidence, stale-record, and
recruiting-window sections; it is not a second delivery path.

## Controls

- A quote binding proves that text exists in the source. It does not prove that
  the quote entails the extracted value. Officer review and the golden set cover
  that different failure class.
- The extraction worker receives no publishing credential or approval function.
- Compression and prompt-rewriting tools do not sit in the extraction request
  path because they would invalidate evidence offsets and transit checks.
- `test:schema` rejects duplicate migration numbers, the superseded parallel
  tables, and pgvector before its benchmark gate.
- The branch does not apply migrations or enable a source. Those are separate
  rollout decisions against a preview database first.

## Remaining work before a live extraction run

1. Apply migration `0011` to a preview database and test RLS with anonymous,
   officer, and service-role clients.
2. Run each connector against a verified vendor endpoint and record fixtures.
3. Expand the golden set from 3 postings to at least 30 across all ten lanes,
   structural restrictions, personal gates, and known false positives.
4. Run classification-only against disabled source snapshots and inspect every
   drop reason. Do not enable recurring source fetches yet.
5. Select an extraction model only after it passes the eval gate with zero
   fabrications, at least 0.95 precision on critical fields, and at least 0.70
   recall on the expanded set.
6. Keep the disposable **Database contracts** workflow green, then repeat the RLS
   acceptance checks against a preview project before applying migrations live.
7. Benchmark lexical and hybrid retrieval on the real corpus. Keep pgvector in
   proposals until hybrid retrieval materially improves the agreed metrics.
