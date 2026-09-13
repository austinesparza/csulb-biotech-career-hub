# Scheduled discovery and Sheet handoff

## Operational loop

1. An officer registers a machine source.
2. The source stays disabled until terms and robots review are recorded.
3. A private test archives evidence without enabling the source.
4. An officer explicitly enables the source.
5. Vercel calls `/api/cron/ingest` at 14:00 UTC every day. The cron and the officer **Run pipeline now** control both call the same `runPipelineCycle()` orchestrator.
6. The cycle first finalizes abandoned `running` fetches whose worker lease expired. Enabled, resumed sources receive at most one retry. Disabled or paused sources are finalized without a retry.
7. The cycle queues only due, enabled, unpaused sources and processes a bounded batch. The database enforces at most one `pending` or `running` fetch per source.
8. Every response is archived before normalization, scoring, or optional model extraction.
9. A deterministic source pass maps graduate stage, audience, scientific lanes, job functions, named methods, compensation status, source dates, and exact eligibility, enrollment, and work-authorization snippets. Unstated claims stay unknown.
10. The cycle repairs any missing source-posting to opportunity review bridge before Sheet delivery.
11. Governed discovery and model extraction run only when explicitly configured. Their output remains private review material.
12. Machine-created review candidates fill unused rows in the configured `Review Queue` Sheet tab.
13. Officers use **Sync review workflow** for the normal spreadsheet round trip. It imports officer edits first, then reconciles and refreshes the Review Queue, so an outbound refresh cannot obscure pending edits.
14. Publication still requires an authenticated officer confirmation. Pipeline, discovery, extraction, and Sheet sync code have no publication authority.
15. Finalized rows are copied to `Archive` and then removed from `Review Queue` on the next sync.

Every canonical cycle writes one private `pipeline_cycles` record with its trigger, worker ID, scheduled and recovered counts, completed, partial, and failed source-run counts, reconciliation results, discovery and extraction summaries, Sheet results, and stage errors. This is the primary end-to-end operations record for pipeline troubleshooting.

## Sheet ownership contract

The application writes only the system-owned columns for rows whose Candidate ID begins with `AUTO-`. It never overwrites Officer Notes, Publish Decision, Public Safe, GitHub Issue / PR, or Reviewer.

For a new machine candidate it writes a neutral row:

- Review Status is `Needs review`
- Event Type is `source_new`
- Publish Decision is blank
- Public Safe is `FALSE`
- Supabase Record ID is the private candidate identifier

Text that begins with a spreadsheet formula character is escaped before writing. Writes use the Google Sheets `RAW` input mode and are capped at 50 candidates per sync, independently of the smaller source-fetch batch limit. New candidates take the first unused row inside the configured bounded range, including preformatted rows whose only value is an unchecked `FALSE` checkbox. A full range raises an operator-visible error instead of placing rows below the visible queue.

Existing rows are matched by Supabase Record ID, then by canonical official source URL. This also links officer-entered Sheet rows to the private record made by their import without taking ownership of their decision cells. URL matching ignores trailing slashes, fragments, and common tracking parameters. Retries remain idempotent.

Resolved rows are archived only after the portal has committed their final database state. The app appends the full 26-column row to the fixed Archive tab before deleting it from Review Queue. If an append succeeds but deletion fails, the next run sees the archived Supabase ID and deletes the queue copy without creating a second archive row.

The Google service account needs the `https://www.googleapis.com/auth/spreadsheets` scope and editor access to the single configured workbook. The spreadsheet ID and range remain fixed production environment variables. No browser receives the service-account key.

## Officer controls

- **Run pipeline now** is the normal on-command operations control. It performs stale-worker recovery, due-source scheduling, source processing, review-bridge reconciliation, configured discovery and extraction, and Sheet delivery through the same orchestrator as cron.
- **Process queued runs now** is an advanced queue-only recovery control. It does not schedule new due sources or run discovery and extraction.
- **Test privately** fetches and archives one reviewed source while it remains disabled or paused. It does not change scheduling or publish.
- **Run and archive now** runs one enabled, unpaused source immediately and then updates the Review Queue.
- **Run employer discovery now** is a narrow diagnostic/manual discovery action. It requires both the Brave API key and explicit result-storage-rights confirmation. Every result remains a private lead.
- **Sync review workflow** is the normal Sheet control. It pulls officer edits first and then refreshes the Review Queue.
- **Pull decisions only** and **Refresh Sheet only** remain advanced one-way controls for troubleshooting or recovery.
- Website publication remains a separate authenticated officer decision.

## Agentic and model boundary

Deterministic retrieval, URL safety, archival, identity matching, canonical classification, and conservative source-evidence extraction run before any model. A configured model may further classify archived text and extract evidence-bearing fields. Unsupported claims remain unknown, evidence-binding failures are retained, and model output cannot approve or publish.

The model is optional. Leave `PIPELINE_MODEL_ENABLED` unset until a reviewed model endpoint, evaluation threshold, budget, and failure policy are configured. A model outage must not erase raw evidence or block later human review.

## Failure behavior

- Fetch failures are finalized in `source_fetch_runs` and count toward source health.
- Abandoned running fetches older than the configured worker lease are explicitly finalized as timeout failures instead of remaining stuck indefinitely.
- Payload and normalization failures remain private and retryable.
- A `partial` source run is tracked separately from a completed run and makes the overall pipeline cycle partial rather than successful.
- Sheet failures do not roll back a completed source archive.
- `pipeline_cycles` preserves stage-level errors and successful earlier work when a later stage fails.
- Cron returns a non-success status when the canonical cycle is not fully successful so runtime observability can alert an operator.
- Weekly health creates deduplicated tasks for failing sources and stale public records.
- No stage publishes without an authenticated active officer decision.
