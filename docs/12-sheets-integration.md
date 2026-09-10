# Google Sheets Integration Model (Issues 23 and 26)

## The one governance rule

**The app is the source of truth for reviewed public records. The Sheet is intake, backup, archive, and an officer-readable mirror.** There is no two-way sync, deliberately: two-way sync creates conflicts the club has no capacity to adjudicate (who wins when an officer edits in the app and someone edits the Sheet? what if a Sheet edit moves a private note into a public column?).

The rule that resolves every case: **Sheet changes create review tasks. They never silently change public records.** This is the same approved-record protection the CSV importer already enforces.

## Three sheet roles, not one shared sheet

| Sheet or tab | Purpose | Who edits |
|---|---|---|
| Raw intake | Roles copied in by officers and trusted contributors | Officers |
| Approved export | App-generated, public-safe records only | App export only |
| Semester archive | Frozen historical record per semester | App export; officers do not edit |

## Intake flow (implemented, pending preview configuration)

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

Implementation notes: the Sheet is registered as a `source_records` row (source_type `spreadsheet`, refresh_policy documents it is officer-triggered). The app uses the official Google Sheets API with a club-owned service account granted read access to that one file. The configured spreadsheet ID, range, source-record UUID, service-account email, and private key are server-only environment variables. No spreadsheet ID, access token, or key is accepted from the browser.

The current officer workbook uses the `Review Queue` tab and 26 columns (`A:Z`). Its `Publish Decision`, `Public Safe?`, reviewer, and Supabase-ID columns are deliberately unmatched by the importer. They cannot approve or publish a record. Source URL, detailed eligibility, career area, stated close date, open status, posted date, and officer notes map into the existing private import contract; officer notes remain private.

## Export flow (Issue 26)

Exports read `public_opportunities` (the public view), so an export physically cannot contain private notes, submitter emails, or unreviewed records. Tabs: Current Approved, Expired/Closed (from `archive_only`/`expired` statuses via an officer-only variant), Archive by Semester. A separate officer-only full backup (CSV download, stored privately) may include private fields and is labeled as such.

## Admin UI

`/admin/import` offers one-click Sheet sync when configured and CSV upload as the Excel/availability fallback. `/admin/integrations` reports the latest import, source fetch, extraction, discovery queue, officer tasks, and public-view count.

## Configuration

1. Create a Google Cloud service account for the club and enable the Google Sheets API.
2. Share only the officer workbook with the service-account email as Viewer.
3. Configure `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_RANGE`, `GOOGLE_SHEETS_SOURCE_RECORD_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in the protected deployment environment.
4. Use a bounded range such as `'Review Queue'!A1:Z500`.
5. Run one preview sync and inspect `import_runs`, `raw_import_rows`, created drafts, and change tasks before production configuration.

If direct sync is unavailable, export the tab as CSV and upload it at `/admin/import`. Both paths invoke the same importer and trust model.
