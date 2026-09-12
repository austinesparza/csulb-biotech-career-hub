# Google Sheets Integration Model (Issues 23 and 26)

## The one governance rule

**The app is the source of truth for reviewed public records. The Sheet is
intake, backup, archive, and a controlled officer-readable review mirror.** Data
moves in both directions only at explicitly owned fields. Supabase owns source
evidence, machine fields, timestamps, record IDs, and publication state. Officers
own notes and Sheet decision cells. Conflicting ownership is rejected rather than
resolved by last-write-wins behavior.

The rule that resolves every case: **Sheet changes create review tasks. They never silently change public records.** This is the same approved-record protection the CSV importer already enforces.

## Three sheet roles, not one shared sheet

| Sheet or tab | Purpose | Who edits |
|---|---|---|
| Review Queue | Officer intake plus private machine candidates awaiting review | Officers in decision columns; app in system columns |
| Archive | Database-finalized Review Queue rows | App; officers do not edit |
| Approved export | App-generated, public-safe records only | App export only |

## Intake flow (implemented, awaiting the first private production sync)

```
Club Google Sheet (raw intake tab)
  → officer clicks "Sync from Sheet" (or uploads CSV as fallback)
  → same pipeline as CSV import:
      raw rows logged in raw_import_rows
      normalize → dedupe → needs_review
      approved+public records: last_seen_at only + import_changed tasks
  → officer clears the review queue
  → board updates
```

Implementation notes: the Sheet is registered as a `source_records` row
(source_type `spreadsheet`, refresh_policy documents it is officer-triggered).
The app uses the official Google Sheets API with a club-owned service account
granted Editor access to that one file. The configured spreadsheet ID, queue
range, archive range, source-record UUID, service-account email, and private key
are server-only environment variables. No spreadsheet ID, access token, or key
is accepted from the browser. Template-only rows in the bounded range are skipped
before CSV import, while partial real rows are retained so validation errors stay visible.

The current officer workbook uses the `Review Queue` tab and 26 columns (`A:Z`). Its `Publish Decision`, `Public Safe?`, reviewer, and Supabase-ID columns are deliberately unmatched by the importer. They cannot approve or publish a record. Source URL, detailed eligibility, eligibility evidence, continued-enrollment rule, work authorization, career area, stated close date, open status, posted date, true last-check date, and officer notes map into the private import contract; officer notes remain private. `Last Checked` is stored only when it is a valid date, and an open or closed source result is trusted only when that check date exists.

## Export flow (Issue 26)

Exports read `public_opportunities` (the public view), so an export physically cannot contain private notes, submitter emails, or unreviewed records. Tabs: Current Approved, Expired/Closed (from `archive_only`/`expired` statuses via an officer-only variant), Archive by Semester. A separate officer-only full backup (CSV download, stored privately) may include private fields and is labeled as such.

## Admin UI

`/admin/import` offers one-click Sheet sync when configured and CSV upload as the Excel/availability fallback. `/admin/integrations` reports the latest import, source fetch, extraction, discovery queue, officer tasks, and public-view count.

## Configuration

1. Create a Google Cloud service account for the club and enable the Google Sheets API.
2. Share only the officer workbook with the service-account email as Editor.
3. Configure `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_RANGE`,
   `GOOGLE_SHEETS_SOURCE_RECORD_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and
   `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in the protected deployment environment.
   Optionally set `GOOGLE_SHEETS_ARCHIVE_RANGE`; it defaults to
   `'Archive'!A1:Z5000`.
4. Use a bounded range such as `'Review Queue'!A1:Z500`.
5. From an authenticated officer session, run one bounded production sync and
   inspect `import_runs`, `raw_import_rows`, created drafts, and change tasks.
   This is a private intake test and cannot publish. Privileged preview execution
   remains blocked intentionally, so do not put the service key in Preview.

If direct sync is unavailable, export the tab as CSV and upload it at `/admin/import`. Both paths invoke the same importer and trust model.


## Machine discovery writeback

The production integration is now two-way at the review boundary. Governed
machine discoveries fill the first unused row inside the bounded `Review Queue`
range or refresh an existing linked row. They never append beyond that configured
range, and a full queue fails visibly. Only
system-owned columns are refreshed for `AUTO-` rows. Officer notes and decision
columns are never overwritten. Officer-entered rows are linked to their private
Supabase record by canonical official source URL after import, so harmless trailing
slashes and tracking parameters cannot create a duplicate. Once an authenticated portal action records a
final database state, the next queue sync appends that row to `Archive` and
deletes it from the queue. Archive IDs make this handoff idempotent after a partial retry.

See [Scheduled discovery and Sheet handoff](./scheduled-sheet-ingestion.md) for
the schedule, retry, idempotency, and publication boundaries.
