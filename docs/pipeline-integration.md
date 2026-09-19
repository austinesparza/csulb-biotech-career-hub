# Integrated discovery and review pipeline

## Current contract

There is one source registry, one observation history, one officer queue, one review Sheet handoff, and one public opportunity table. Automated retrieval, discovery, extraction, and reconciliation add private evidence to that system. They do not create a second publishing path.

| Responsibility | Canonical table, view, or service |
|---|---|
| Source provenance | `source_records` |
| Approved machine-readable sources | `job_sources` |
| Fetch queue and history | `source_fetch_runs` |
| Private raw payload metadata | `source_payloads` |
| Current source posting | `source_postings` |
| Immutable normalized observation | `source_posting_versions` |
| Bound model output | `pipeline_extractions` |
| End-to-end cycle observability | `pipeline_cycles` |
| Officer work | `review_tasks` plus pending `opportunities` |
| Spreadsheet handoff | `Review Queue` and `Archive`, reconciled through the application |
| Public records | `opportunities` through `public_opportunities` |
| Public suggestions | `user_submissions` |

The SQL proposals under `supabase/proposals` are retained for design history and are not run by the migration tool.

## Canonical orchestration

`src/lib/pipeline-cycle.ts` owns the normal private operations sequence. Both `/api/cron/ingest` and the officer **Run pipeline now** action call `runPipelineCycle()` rather than maintaining separate versions of the workflow.

The ordered cycle is:

1. Recover abandoned running source fetches after the worker-lease timeout.
2. Queue due, enabled, unpaused sources.
3. Claim and process a bounded source-fetch batch.
4. Reconcile any reviewable source posting that is missing its canonical opportunity bridge.
5. Run governed employer/lane discovery only when explicitly enabled.
6. Run evidence-bound model extraction only when explicitly enabled.
7. Deliver private review candidates to Google Sheets when configured.
8. Finalize one `pipeline_cycles` record with stage counts, partial/failure state, and errors.

The database enforces at most one active `pending` or `running` fetch for a source. Stale-worker recovery finalizes abandoned work as a timeout failure and queues at most one retry only when the source remains enabled and unpaused.

A source run can be `completed`, `partial`, or `failed`. Partial is not counted as completed. Any partial source run or stage error makes the overall cycle partial so the officer UI and runtime monitoring do not report false success.

## Source and review flow

1. An officer approves a `job_sources` record only after terms and robots review. Sources are disabled by default.
2. The connector and persistence bridge create a fetch run, store the private payload, upsert the source posting, append a posting version, and open a review task using the canonical persistence contract.
3. The deterministic classifier reads normalized posting text. It keeps scientific lanes, job functions, and methods separate. Ambiguous MSc access remains unresolved rather than being labelled eligible.
4. An extraction model may process the immutable posting version. Every asserted field includes source evidence, and code checks evidence against the exact normalized text stored in that version.
5. `pending_pipeline_extractions` selects work for an exact schema and prompt version. A prompt upgrade can therefore reprocess the same immutable source without deleting history.
6. `persist_pipeline_extraction` stores output and attaches it to the existing source-posting review task. Extraction neither creates a parallel publication path nor changes public opportunity fields.
7. The reconciliation bridge materializes reviewable source postings into the existing opportunity-review workflow when that link is missing. The operation is idempotent.
8. Machine-created candidates are delivered to the fixed `Review Queue` Sheet range without overwriting officer-owned decision cells.
9. The normal **Sync review workflow** action imports officer Sheet edits first, then reconciles and refreshes the Sheet. One-way pull and refresh controls remain available only as advanced recovery tools.
10. `/admin/review` and the publication controls keep final approval with an authenticated active officer.
11. `decide_opportunity_review` changes the opportunity, resolves linked review tasks, records the officer and final decision, and optionally exposes the company in one transaction.
12. The public view admits only approved, public-safe, open, audience-eligible records.

## Classification ownership

`pipeline/classify.ts` is the canonical subject and eligibility classifier. `relevance.ts` only orders already-created review records by practical factors such as deadline, compensation, location, and whether MSc eligibility is stated. It does not decide inclusion. `focusAreas.ts` is a legacy display adapter for the single `focus_area` column; new structured records use `scientific_lanes`, `job_functions`, and `methods`.

## Digest ownership

`scripts/review-digest.mjs` is the production entrypoint for the weekly review digest. It owns the Supabase query, combined opportunity/submission reminder, configuration checks, Gmail transport, HTML escaping, and scheduled workflow. `pipeline/digest.ts` remains a pure formatter experiment for future source-health, evidence, stale-record, and recruiting-window sections; it is not a second delivery path.

## Safety controls

- A quote or evidence binding proves that text exists in the source. It does not by itself prove that the text entails the extracted value. Human review and the evaluation set cover that different failure class.
- Retrieval, discovery, extraction, reconciliation, and Sheet synchronization do not receive publication authority.
- Compression and prompt-rewriting tools do not sit in the extraction request path because they can invalidate evidence offsets and transit checks.
- Raw source payloads and immutable posting versions remain available even when a later stage fails.
- `test:schema` rejects duplicate migration numbers, superseded parallel tables, and pgvector before its benchmark gate.
- The disposable **Database contracts** workflow applies every migration to a clean database and runs SQL contract tests. It does not deploy migrations to production.
- Production database migrations remain an explicit rollout action. Application deployment and database migration must both be verified before the new orchestration path is treated as live.

## Operational wiring

- `/api/cron/ingest` runs the canonical cycle on the production Vercel schedule.
- `/admin/sources` exposes **Run pipeline now** as the normal officer control and keeps queue-only processing under an advanced recovery section.
- Per-source **Test privately** and **Run and archive now** remain available for source-specific validation and intervention.
- `scripts/run-ingestion-worker.ts` remains useful for direct worker operations, but it is not a second scheduler.
- `scripts/run-extraction-worker.ts` remains useful for direct extraction operations, but normal configured extraction is orchestrated by the shared cycle.
- Governed discovery requires the search provider configuration and explicit result-storage-rights confirmation. Search results remain private leads until they enter officer review.
- Discovery feedback, shadow ranking, and query-family yield follow `docs/discovery-learning.md`. Learned estimates are advisory and never filter, approve, or publish a record.
- Google Sheets is a review surface, not a publication authority. The normal bidirectional sync pulls officer edits before pushing the refreshed queue.
- See `docs/scheduled-sheet-ingestion.md` for the operational sequence and failure behavior.

## Validation gates

Before changing retrieval, model, or publication behavior, preserve these gates:

1. Database contracts must apply all migrations from a clean database and pass every SQL invariant test.
2. Type checking, unit tests, production build, and security scanning must remain green.
3. Connector changes should be verified against vendor fixtures and a reviewed live endpoint before broadening scheduled use.
4. Model extraction should remain optional until a real officer-labelled evaluation set meets the agreed precision, recall, fabrication, budget, and failure-policy thresholds.
5. Classification-only experiments should use private or disabled-source snapshots before recurring source coverage is expanded.
6. Publication remains a separate authenticated officer decision regardless of retrieval or model quality.
7. A learned discovery ranker cannot influence ordering or search allocation until its time-ordered holdout passes the documented sample, discrimination, and calibration gates in a separately reviewed change.
