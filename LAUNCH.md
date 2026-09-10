# LAUNCH.md — from zip to live board (~90 minutes)

Work top to bottom. Check each box. Details live in docs/07-deployment.md; this is the day-of sequence.

## Phase 1: Prove the build (~15 min)

- [x] Repository is checked out and builds from a clean dependency install.
- [x] `npm ci`
- [x] Run `npm run typecheck`, `npm run lint`, `npm test`,
      `npm run test:pipeline`, `npm run test:digest`, `npm run test:publish-data`,
      `npm run test:schema`, and `npm run build`.
- [ ] Transfer the working GitHub repo from `austinesparza` to a club organization
      and verify `main` protection. CI and Vercel deployment are active now, but
      personal ownership remains a turnover risk.

## Phase 2: Supabase (~20 min)

- [ ] Confirm the existing Supabase project's club owner and shared password-manager
      entry. The production project exists, but ownership documentation is still missing.
- [x] Apply executable migrations in numeric order. Do not run anything under
      `supabase/proposals/`. Test new migrations against a preview database first.
- [x] Confirm the pull request's **Database contracts** check passed against a
      disposable clean database before applying any migration to production.
- [x] Do not run `supabase/seed.sql` in the populated production project. It is
      bootstrap-only and would add an `Example Biosciences` demo row.
- [ ] Decide whether the historical archive is still needed before running
      `supabase/seed_historical.sql` once. Check for duplicate companies and
      source records first; do not run it merely to complete this checklist.
- [ ] Auth → disable signups; invite each officer by email
- [ ] For each officer: `insert into officers (user_id, display_name) values ('<auth uid>', 'Name');`
- [x] Verify the privacy boundary: in the SQL editor, as anon
      (`set role anon; select * from opportunities;`) — must be DENIED;
      `select * from public_opportunities;` — must return only officer-approved,
      public-safe rows. `reset role;`

## Phase 3: Vercel (~15 min)

- [x] Import the GitHub repo (club Vercel account)
- [x] Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`
- [ ] Confirm `CRON_SECRET` is Production-only and at least 32 characters, then
      confirm `/admin/integrations` reports scheduled orchestration as Ready.
- [ ] Confirm the five `GOOGLE_*` variables are Production-only before the first
      bounded Sheet sync. Preview deployments must not receive privileged keys.
- [x] Deploy; the production landing page reads the approved Supabase view
- [ ] Point `careers.<clubdomain>` CNAME at Vercel (can come later)

## Phase 4: Real data (~30 min)

- [ ] Sign in at `/admin/login`
- [ ] `/admin/import` → run one bounded **Sync from Google Sheet** test. If the
      direct connection is unavailable, export the tab as CSV, select **Club
      Internship Spreadsheet**, and upload it instead.
- [ ] Read the import summary: errors and ignored columns tell you what the sheet
      needs (or what `HEADER_ALIASES` needs)
- [ ] `/admin/review` → work the queue: open each link, set notes, approve/reject
- [x] Confirm no demo row remains. The production public view currently contains
      four reviewed opportunity records and no demo-titled record.
- [ ] Check `/internships` as a logged-out student on your phone

## Phase 5: Announce (~10 min)

- [ ] Add a Career Hub link to the club website nav
- [ ] Resolve every item marked **Not documented** in HANDOFF.md.
- [ ] Post in the club Discord/newsletter
- [ ] Put the weekly 25-minute review routine on an officer's calendar — an
      unstaffed board goes stale, and stale is worse than nothing

## Launch acceptance test

A student who has never seen the app finds a paid, currently-open internship in
their focus area in under 30 seconds, and the source link works. Then re-import
the same CSV and confirm zero approved listings changed.

## After launch (in order, from docs/10-github-issues.md)

Keep the review queue staffed for three real weeks before enabling recurring
source discovery. Model extraction remains advisory and may never publish.
