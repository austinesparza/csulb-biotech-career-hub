# D. Database Schema (design)

Implemented in `supabase/migrations/0001_init.sql` (deliverable E). Postgres, all PKs `uuid default gen_random_uuid()`, all tables have `created_at`/`updated_at`, RLS enabled.

## Entity relationships

```
source_records 1──* import_runs 1──* raw_import_rows *──? opportunities
source_records 1──* opportunities
companies      1──* opportunities
opportunities  *──? opportunities (duplicate_of, self-ref)
people         1──? mentorship_profiles
people         1──* events (speaker)
career_paths   1──* resources
review_tasks   *──1 (polymorphic: entity_table + entity_id)
user_submissions ──? opportunities (created_opportunity_id)
semester_reports (standalone, stats jsonb)
officers       *──1 auth.users
```

## Tables (columns per spec)

**source_records** — where data comes from and the rules for it.
`name, source_type (spreadsheet|manual|student_submission|partner|website_page), url, owner, access_level (public|members|officers), canonical_status, refresh_policy (text, e.g. "manual re-export each month; no automated access permitted"), last_imported_at, last_reviewed_at, public_safe, notes`

**import_runs** — one row per CSV upload: `source_record_id (NOT NULL — provenance is mandatory), filename, uploaded_by, started_at, finished_at, status, total_rows, inserted_count, updated_count, duplicate_count, error_count, notes`

**raw_import_rows** — audit trail: `import_run_id, row_number, raw jsonb, parse_status (ok|error|skipped), error_message, matched_opportunity_id`. Never mutated after insert; lets officers answer "where did this record come from?" forever.

**companies** — `name, name_normalized (unique), website, location, industry_tags text[], description, public_safe, notes_private`

**opportunities** — full spec: `company_id, source_record_id (nullable for legacy rows only; import flow always sets it), title, posting_url, location, eligibility, focus_area, deadline (date, strictly validated), deadline_text (original), start_date_text, paid_status (paid|unpaid|stipend|unknown), application_type, source_status_raw, status (11-value enum), public_notes, private_notes (imports land here), date_added, first_seen_at, last_seen_at, last_checked_at, relevance_score, relevance_reasons text[], review_status (pending|approved|rejected|changes_requested), public_safe, dedupe_key (strict: company|full title|url), family_key (season/year-stripped, flagging only), duplicate_of`

**people** — mentors/alumni/speakers/officers: `full_name, role_types person_role[], email, linkedin_url, affiliation, title, bio, photo_url, contact_public (bool — email/LinkedIn hidden unless true), consent_on_file, consent_date, consent_notes, public_safe`

**mentorship_profiles** — `person_id, focus_areas text[], availability, meeting_format, ask_me_about, accepting_mentees, public_safe`

**events** — workshops + speaker series: `title, event_type (workshop|speaker_series|other), event_date, speaker_person_id, description, recording_url, slides_url, public_safe`

**resources** — `title, resource_type (guide|template|link|recording|post), url, description, career_path_id, tags text[], public_safe, last_reviewed_at`

**career_paths** — `name, slug (unique), description, typical_roles text[], education_notes, sort_order, public_safe`

**review_tasks** — the officer work queue: `task_type (new_import|possible_duplicate|possible_repost|broken_link|expiring|submission|consent_check|stale_record|import_changed), entity_table, entity_id, status (open|in_progress|done|dismissed), assigned_to, due_date, notes, resolved_at`

**user_submissions** — voluntary public form: `submission_type (opportunity|mentor_update|resource|correction), payload jsonb, submitter_name, submitter_email, status (new|in_review|approved|rejected|spam), reviewed_by, reviewed_at, created_opportunity_id, notes`

**semester_reports** — `semester_label ("Fall 2026"), starts_on, ends_on, stats jsonb, narrative, published`

**officers** — allowlist: `user_id (FK auth.users), display_name, is_active`

## Status semantics (opportunities.status)

| Status | Meaning | Public? |
|---|---|---|
| open_verified | Officer confirmed link works & posting open | Yes |
| open_unverified | Imported as open, not yet re-checked | Yes (labeled "unverified") |
| closed | Employer closed applications | No |
| expired | Deadline passed | No |
| unknown | Can't determine | No |
| archive_only | Kept for history/reports | No |
| needs_review | Default after import | No |
| broken_link | URL dead at last check | No |
| duplicate | Points at `duplicate_of` | No |
| not_relevant | Off-mission | No |
| hidden | Manually suppressed | No |

Public visibility = `status IN (open_verified, open_unverified) AND review_status = 'approved' AND public_safe = true`. Enforced in the `public_opportunities` view, not in app code.

## Security model
1. RLS on every base table; only `is_officer()` (SECURITY DEFINER check against `officers`) may select/insert/update.
2. Anon role gets SELECT only on `public_*` views, which include only public-safe columns (no `private_notes`, no `email` unless `contact_public`). `authenticated` gets the same view-only grants — a signed-in non-officer sees nothing extra.
3. `user_submissions` additionally allows anon INSERT (the submit form) — insert-only, never read.
4. Service-role key used only in server actions, and only after `requireOfficer()` succeeds; anon key in the browser.
5. Approved+public opportunities are never field-mutated by imports (app-level rule in `decideUpdatePolicy`, see docs/08).
