# Scheduled discovery and Sheet handoff

## Operational loop

1. An officer registers a machine source.
2. The source stays disabled until terms and robots review are recorded.
3. A private test archives evidence without enabling the source.
4. An officer explicitly enables the source.
5. Vercel calls `/api/cron/ingest` at 14:00 UTC every day.
6. The cron queues only due, enabled, unpaused sources and runs a bounded batch.
7. Every response is archived before normalization, scoring, or optional model extraction.
8. Machine-created review candidates are appended to the configured `Review Queue` Sheet tab.
9. Officers work in the Sheet, then use **Pull decisions from Sheet** in the portal.
10. Publication still requires **Confirm Sheet approval and publish** while signed in.

The same Sheet push runs after **Run and archive now**. If the source run
succeeds but Google is unavailable, the archived result is retained and the
officer can retry **Push discoveries to Sheet** without rerunning the source.

## Sheet ownership contract

The application writes only the system-owned columns for rows whose Candidate
ID begins with `AUTO-`. It never overwrites Officer Notes, Publish Decision,
Public Safe, or GitHub Issue / PR.

For a new machine candidate it writes a neutral row:

- Review Status is `Needs review`
- Event Type is `source_new`
- Publish Decision is blank
- Public Safe is `FALSE`
- Supabase Record ID is the private candidate identifier

Text that begins with a spreadsheet formula character is escaped before writing.
Writes use the Google Sheets `RAW` input mode and are capped at 50 candidates
per run. Existing rows are matched by Supabase Record ID, then by official
source URL. This makes retries idempotent.

The Google service account needs the
`https://www.googleapis.com/auth/spreadsheets` scope and editor access to the
single configured workbook. The spreadsheet ID and range remain fixed
production environment variables. No browser receives the service-account key.

## On-command controls

- **Test privately** fetches and archives one reviewed source while it remains
  disabled or paused. It does not change scheduling or publish.
- **Run and archive now** runs one enabled, unpaused source and then updates the
  Review Queue.
- **Push discoveries to Sheet** retries only the database-to-Sheet handoff.
- **Pull decisions from Sheet** archives Sheet rows and updates private drafts.
- **Confirm Sheet approval and publish** is the only path from a Sheet-reviewed
  draft to the public database view.

## Agentic and model boundary

Deterministic retrieval, URL safety, archival, identity matching, and lifecycle
rules run before any model. A configured model may classify archived text and
extract evidence-bearing fields. Unsupported claims remain unknown, evidence
binding failures are retained, and model output cannot approve or publish.

The model is optional. Leave `PIPELINE_MODEL_ENABLED` unset until a reviewed
model endpoint, evaluation threshold, budget, and failure policy are configured.
A model outage must not erase raw evidence or block later human review.

## Failure behavior

- Fetch failures are finalized in `source_fetch_runs` and count toward source
  health.
- Payload and normalization failures remain private and retryable.
- Sheet failures do not roll back a completed source archive.
- Cron returns a non-success status for source, extraction, or Sheet failures so
  Vercel observability can alert an operator.
- Weekly health creates deduplicated tasks for failing sources and stale public
  records.
- No stage publishes without an authenticated active officer decision.
