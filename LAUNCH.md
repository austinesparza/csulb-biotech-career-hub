# LAUNCH.md — from zip to live board (~90 minutes)

Work top to bottom. Check each box. Details live in docs/07-deployment.md; this is the day-of sequence.

## Phase 1: Prove the build (~15 min)

- [ ] Unzip the repo, `cd csulb-biotech-career-hub`
- [ ] `npm ci`
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`,
      `npm run test:pipeline`, `npm run test:digest`, `npm run test:publish-data`,
      `npm run test:schema`, and `npm run build`.
- [ ] Create the GitHub repo under the CLUB org (not a personal account), push, protect `main`

## Phase 2: Supabase (~20 min)

- [ ] Create project on a club-owned account (credentials into the shared password manager)
- [ ] Apply executable migrations in numeric order. Do not run anything under
      `supabase/proposals/`. Test new migrations against a preview database first.
- [ ] Confirm the pull request's **Database contracts** check passed against a
      disposable clean database before applying any migration to production.
- [ ] Run `supabase/seed.sql`
- [ ] Run `supabase/seed_historical.sql` ONCE (past cycles: 2024-2025 post +
      2025-2026 sheet, ~50 archive records + ~30 companies + 2 resources)
- [ ] Auth → disable signups; invite each officer by email
- [ ] For each officer: `insert into officers (user_id, display_name) values ('<auth uid>', 'Name');`
- [ ] Verify the privacy boundary: in the SQL editor, as anon
      (`set role anon; select * from opportunities;`) — must be DENIED;
      `select * from public_opportunities;` — must return the demo row. `reset role;`

## Phase 3: Vercel (~15 min)

- [ ] Import the GitHub repo (club Vercel account)
- [ ] Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`
- [ ] Deploy; landing page should show the demo posting count
- [ ] Point `careers.<clubdomain>` CNAME at Vercel (can come later)

## Phase 4: Real data (~30 min)

- [ ] Sign in at `/admin/login`
- [ ] Export the club internship sheet as CSV
- [ ] `/admin/import` → source: Club Internship Spreadsheet → upload
- [ ] Read the import summary: errors and ignored columns tell you what the sheet
      needs (or what `HEADER_ALIASES` needs)
- [ ] `/admin/review` → work the queue: open each link, set notes, approve/reject
- [ ] Delete the demo row (it says so in its title)
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
