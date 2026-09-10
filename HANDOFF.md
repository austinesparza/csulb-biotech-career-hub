# HANDOFF.md — Officer Runbook

> Resolve each **Not documented** item before treating this as a complete handoff.

## Accounts & credentials
- GitHub: `austinesparza/csulb-biotech-career-hub` — personal ownership is a
  transition risk; move it to a club organization when available.
- Supabase project URL, owner, and password-manager location: **Not documented — launch blocker.**
- Vercel: CSULB Biotechnology Club — production:
  `https://csulb-biotech-career-hub.vercel.app/`.
- At least two active officers + one advisor must hold access at all times.

## Weekly routine (~25 min)
1. If the spreadsheet changed: `/admin/import` → Sync from Google Sheet. If unavailable, export CSV → select the source → upload.
2. Open `/admin/integrations` and confirm the import completed with the expected row and error counts.
3. `/admin/review`: clear the queue. Open each posting link before approving. Move anything student-useful from private notes into public notes; everything else stays private.
4. Click "expire past-deadline" sweep.
5. Check new submissions and any "import changed" tasks (a re-import found differences on an already-published listing — apply manually or dismiss).
6. Check the configured private review inbox for "Career Hub:" subject lines.
   During development, this must be one officer's personal address, not the club mailbox.

## Monthly
- `/admin` → Export approved CSV → save to the club backup location.
  Backup owner and location: **Not documented — launch blocker.**
- Review `open_unverified` older than 30 days: verify (Mark checked) or expire.
- Review open review_tasks older than 2 weeks.

## Each semester
- Generate the Semester Impact Report (`/admin` → Reports) before finals.
- Officer transition: add new officers (Supabase Auth invite + `officers` insert), deactivate departed (`is_active=false`), rotate shared credentials, walk through this file together.

## How things work (30-second version)
Listings can enter through the spreadsheet, the public submission form, or an
officer-approved automated source. Every fetch is retained as an immutable source
version. The graduate classifier suggests scientific lanes, job functions,
methods, degree stage, and access restrictions. Extraction may suggest facts only
when each asserted value has a verbatim quote in the stored source text. Nothing
becomes public until an officer opens the source, confirms the public-safe fields,
and approves the review card. Once published, later imports or fetches create a
review task instead of silently changing the listing.

Private notes, submitter contact information, raw source text, and unapproved
model output never appear on the public board. The database policies and atomic
review function enforce that separation.

## Developer checks

Run the complete matrix before pushing pipeline or review changes:

```bash
npm run typecheck
npm run lint
npm test
npm run test:pipeline
npm run test:digest
npm run test:publish-data
npm run test:schema
npm run build
```

If a skill installed with `npx skills add` is present under `.agents/skills/` but
Claude Code cannot see it, link that skill into `.claude/skills/`. Do not copy a
second independent version.

## Common fixes
- **Bad record on the public board:** `/admin/review` → find it → Hide. Instant, no deploy.
- **Import fails "could not find required columns":** a header was renamed in the sheet. Add the new name to `HEADER_ALIASES` in `src/lib/csvImport.ts` (or rename the column back) and re-import.
- **Import fails "source record is required":** pick a source in the dropdown; if the source is new, add it under Sources first.
- **Sheet sync says it is not configured:** verify all five `GOOGLE_*` server variables, confirm the source UUID exists, and confirm the service-account email has Viewer access to only the intended workbook.
- **Sheet sync reads the wrong columns:** keep the intake headers aligned with `HEADER_ALIASES` and the configured bounded range. Never map `Publish Decision` or `Public Safe?` into the importer.
- **Site seems down:** free-tier Supabase pauses after inactivity; open the Supabase dashboard and restore. Vercel status: check the deployments tab.
- **Mentor asks to be removed:** people table → `public_safe=false`, note it in `consent_notes`. Done.

## Rules that keep us out of trouble

### Weekly review email

The scheduled GitHub workflow only summarizes the private review queue. It cannot
publish records. Its recipients and Gmail OAuth credentials live in the protected
`production` environment. Follow `docs/weekly-review-notifications.md` when adding
or changing recipients. Never commit an address, OAuth token, or Supabase secret key.
- Never paste private officer notes into public fields.
- Never publish a person without recorded consent.
- Never enable an automated source until its terms, robots policy, owner, and
  refresh policy are recorded. Keep prohibited or uncertain sources manual.
