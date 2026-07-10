# J. Admin Review Workflow

## The invariants
1. A record is public **iff** `public_safe = true` AND `review_status = 'approved'` AND `status ∈ {open_verified, open_unverified}`. Enforced by the `public_opportunities` view; no app code can bypass it.
2. Once approved and public, a record is **import-immutable**: re-imports touch `last_seen_at` only and open `import_changed` tasks for differences. Only officers change published listings.

## Lifecycle

```
import/submission ──▶ needs_review (pending, not public)
                          │ officer opens review queue (sorted by relevance desc)
              ┌───────────┼────────────────┬──────────────┬─────────────┐
              ▼           ▼                ▼              ▼             ▼
        APPROVE      MARK DUPLICATE    REJECT         HIDE        EDIT+APPROVE
   verify link OK?   pick survivor;   not_relevant   hidden       fix fields, promote
   yes→open_verified loser: status=   (kept for                   any public-safe text
   no time→          duplicate,       records)                    from private_notes,
   open_unverified   duplicate_of=X                               then approve
   set public_safe✓
              │
              ▼  (ongoing maintenance)
   "Mark checked" → last_checked_at=now, unverified→verified
   deadline passes → expired (weekly sweep, one SQL update or button)
   dead URL → broken_link + review task
   re-import differs from approved record → import_changed task (field diff shown)
   semester ends → archive_only (kept for impact reports)
```

## Review queue UI behavior (M1, `/admin/review`)
Each row shows: parsed fields, `source_status_raw` as a hint chip, relevance score with expandable reasons, `private_notes` (imported spreadsheet notes) clearly labeled "officers only", and the raw source row (from `raw_import_rows`) on demand. Actions are one click each; approve requires the officer to have opened the posting URL (link opens in new tab; approve button enables after click — cheap honesty nudge, not a hard gate).

Notes rule shown in the UI: *imported spreadsheet notes land in private_notes and are never shown to students. If part of a note is safe and useful for students, copy that part into public_notes before approving.*

## `import_changed` tasks
When a re-import finds an approved record whose source row changed (deadline moved, URL changed, status column updated), the task shows a field-level diff. The officer either applies the change manually (and re-verifies the link) or dismisses the task. This is deliberate friction: published listings only change by officer action.

## Submissions (M2)
`user_submissions` queue: officer opens payload → Approve creates a draft opportunity (linked via `created_opportunity_id`) which then flows through the normal review path — approval of a submission is not publication. Reject/spam requires no reason but accepts a note.

## Duplicate & repost resolution (`/admin/review?tab=duplicates`)
Side-by-side: fields diffed, newer `last_seen_at` highlighted. For `possible_duplicate`: officer picks survivor; the other becomes `duplicate` pointing at it (merge better data into the survivor first — manual, with prefilled suggestion). For `possible_repost` (same title family, different season/year): the default is **keep both** — new cycles are usually legitimately new postings; mark duplicate only if it's truly the same posting re-listed.

## Weekly officer routine (goes in HANDOFF.md)
1. Import latest CSV if the sheet changed (10 min).
2. Clear review queue; verify links on anything expiring soon (15 min).
3. Sweep: mark past-deadline postings expired (1 click).
4. Check submissions and import_changed tasks.
Monthly: export approved CSV as backup; review `open_unverified` older than 30 days (verify or expire).

## Consent workflow (people records, M3)
Adding a mentor/alumnus/speaker auto-creates a `consent_check` task. Publication checklist: consent recorded (`consent_on_file`, `consent_date`) → decide `contact_public` → then `public_safe`. Removal request = flip `public_safe` off, note in `consent_notes`.
