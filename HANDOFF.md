# HANDOFF.md — Officer Runbook

> Fill the bracketed items during setup (Issue #13). A new officer should be able to run everything using only this file.

## Accounts & credentials
- GitHub org: [org name] — repo `csulb-biotech-career-hub`
- Supabase project: [url] — owner: [club email]; credentials in [password manager location]
- Vercel team: [name] — production: [domain]
- At least two active officers + one advisor must hold access at all times.

## Weekly routine (~25 min)
1. If the spreadsheet changed: export CSV → `/admin/import` → select the source → upload.
2. `/admin/review`: clear the queue. Open each posting link before approving. Move anything student-useful from private notes into public notes; everything else stays private.
3. Click "expire past-deadline" sweep.
4. Check new submissions and any "import changed" tasks (a re-import found differences on an already-published listing — apply manually or dismiss).
5. Check csubiotechclub@gmail.com for "Career Hub:" subject lines (set up a Gmail filter that labels these once).

## Monthly
- `/admin` → Export approved CSV → save to [backup location].
- Review `open_unverified` older than 30 days: verify (Mark checked) or expire.
- Review open review_tasks older than 2 weeks.

## Each semester
- Generate the Semester Impact Report (`/admin` → Reports) before finals.
- Officer transition: add new officers (Supabase Auth invite + `officers` insert), deactivate departed (`is_active=false`), rotate shared credentials, walk through this file together.

## How things work (30-second version)
Spreadsheet CSV → import (nothing public, source required) → officer review (approve + public-safe) → student board. Once published, imports can't change a listing — you'll get a task instead. Private notes and raw import rows never appear publicly — enforced by the database, not by carefulness.

## Common fixes
- **Bad record on the public board:** `/admin/review` → find it → Hide. Instant, no deploy.
- **Import fails "could not find required columns":** a header was renamed in the sheet. Add the new name to `HEADER_ALIASES` in `src/lib/csvImport.ts` (or rename the column back) and re-import.
- **Import fails "source record is required":** pick a source in the dropdown; if the source is new, add it under Sources first.
- **Site seems down:** free-tier Supabase pauses after inactivity; open the Supabase dashboard and restore. Vercel status: check the deployments tab.
- **Mentor asks to be removed:** people table → `public_safe=false`, note it in `consent_notes`. Done.

## Rules that keep us out of trouble
- Never paste private officer notes into public fields.
- Never publish a person without recorded consent.
- Never add code that automatically pulls data from external websites — manual links and reviewed submissions only.
