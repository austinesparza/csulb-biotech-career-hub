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

## Intake flow (Issue 23)

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

Implementation notes: the Sheet is registered as a `source_records` row (source_type `spreadsheet`, refresh_policy documents it is officer-triggered). Use the official Google Sheets API with a club-owned service account granted read access to that one sheet. This is API access to the club's own document, not collection from external sites; the no-scraping rule is untouched.

## Export flow (Issue 26)

Exports read `public_opportunities` (the public view), so an export physically cannot contain private notes, submitter emails, or unreviewed records. Tabs: Current Approved, Expired/Closed (from `archive_only`/`expired` statuses via an officer-only variant), Archive by Semester. A separate officer-only full backup (CSV download, stored privately) may include private fields and is labeled as such.

## Suggested admin UI (when built)

`/admin/sources`: one card per source with last-imported date, rows seen, new rows, changed-approved count, errors, and buttons: Sync from Sheet, Upload CSV instead, Export approved, Archive semester.

## Until Issues 23/26 are built

The current flow already works with Sheets manually: export the sheet as CSV, import at `/admin/import`, and download the approved CSV from `/api/export` to paste into an archive tab. The integration only removes those two manual steps; it does not change the trust model.
