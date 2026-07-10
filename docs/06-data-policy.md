# L. Public/Private Data Policy

## Rules (enforced in schema, not convention)

1. **Public = view-only.** The anon key has zero grants on base tables. Student pages query `public_opportunities`, `public_companies`, `public_mentors`, `public_events`, `public_resources`, `public_career_paths`. A record appears only when `review_status='approved'` (where applicable) AND `public_safe=true` AND status is publicly visible.
2. **Private notes never leak.** `private_notes`, `notes_private`, `review_tasks`, `raw_import_rows`, `user_submissions`, submitter emails, and consent notes are simply not columns/tables in any public view. Leaking them would require editing the migration — reviewable in a PR. Imported spreadsheet notes land in `private_notes` by default; only officer-written text goes in `public_notes`.
3. **Approved records are import-immutable.** Once an officer approves and publishes a record, a re-import can only refresh `last_seen_at`. Field differences open an `import_changed` review task. Nothing a student sees changes without an officer acting.
4. **Personal contact info is opt-in.** `people.email`/`linkedin_url` appear in `public_mentors` only when `contact_public=true`. Default is false. Officers must record `consent_on_file` + `consent_date` before flipping `public_safe` on any person.
5. **Consent for people records.** Mentors, alumni, and speakers get a short consent note (email is fine) before publication; store the date and summary in `consent_notes`. Removal requests: flip `public_safe=false` — takes effect immediately, no deploy.
6. **No implied endorsement.** Global footer + /about disclaimer; per-record language is neutral ("listed", never "recommended"). An `endorsed` flag is deliberately absent — if the club later wants featured postings, add an explicitly approved `featured_note` field then.
7. **Provenance on every public record.** Every import requires a named source; cards show source name and `last_checked_at`; `open_unverified` postings carry a visible "not yet re-verified" label.

## Source rules
Every source lives in `source_records` with `access_level` and a human-readable `refresh_policy`. For sources that prohibit automated access, the policy field says so and the only allowed entries are manually pasted links, voluntary submissions, or officer-typed records. The app contains no code that fetches external sites.

## Data minimization
- Students: no accounts, no tracking beyond Vercel's default analytics (can be disabled).
- Submissions: name/email optional; auto-delete rejected/spam submissions after 90 days (manual purge button in MVP).
- People: store only what will be displayed plus consent metadata.

## Officer checklist before approving anything public
1. Link works and points where it claims. 2. No private info in public fields — including anything still sitting in imported notes. 3. For people: consent recorded. 4. Status and deadline sane. 5. `public_safe` checked last.
