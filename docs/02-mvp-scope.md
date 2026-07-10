# B. MVP Scope

## In scope (MVP = Milestone 1)
1. **CSV import** of the existing internship spreadsheet (column aliases handled; raw rows preserved in `raw_import_rows`; each run logged in `import_runs`; a source record is **required** for every import).
2. **Normalization** into `companies` + `opportunities` (dates strictly validated, paid status normalized, URLs canonicalized and restricted to http/https).
3. **Deduplication**: same-URL/strict-key auto-refresh, family (season/year) and fuzzy matches flagged as review tasks — never auto-merged or deleted.
4. **Approved-record protection**: once a record is approved and public, re-imports only touch `last_seen_at`; changed fields open a review task instead of mutating the listing.
5. **Status tracking** with the full 11-status enum from day one.
6. **Officer review** queue; nothing public until `review_status = approved` AND `public_safe = true`. Imported spreadsheet notes land in `private_notes` by default.
7. **Relevance score** (0–100, rule-based, stored with reasons) to sort the review queue and default-sort the board.
8. **Student board** (`/internships`): search, filters (focus area, paid, location, deadline), approved records only; all filter input sanitized.
9. **Provenance**: source URL, source record, `last_checked_at` shown on every public card.
10. **Export**: CSV/JSON of approved records for the existing website (reads the public view only).
11. **Maintainability**: one repo, one migration file, seeded demo data, `HANDOFF.md` runbook.

## Out of scope for MVP (schema ready, UI deferred)
- Mentor Network, Alumni Network, Speaker Library pages (M3)
- Career Pathways + Resource Library pages (M3)
- Submit-an-Opportunity public form (M2)
- Semester Impact Report generation (M4)
- Automated link checking (M4, manual "mark checked" button in MVP)
- Student accounts, favorites, email alerts — not planned; keep the system anonymous-read

## Explicit non-goals (permanent)
- No scraping or automated collection from external sites. Sources that prohibit automated access are represented only as manually entered links or officer-reviewed submissions, tracked in `source_records` with `access_level` and `refresh_policy = manual`.
- No storing of student personal data beyond optional submitter contact on voluntary submissions.

## MVP acceptance test
An officer imports the real spreadsheet, resolves the review queue in one sitting, and a student can find a paid, currently-open internship by focus area in under 30 seconds — with a working source link and a visible last-checked date. Then the officer re-imports the same file and verifies zero approved listings changed.
