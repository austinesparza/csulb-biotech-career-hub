# M. Deployment Plan

## One-time setup (~1 hour, documented for handoff)

1. **GitHub:** create org-owned repo (club GitHub org, not a personal account — critical for handoff). Protect `main`; PRs required.
2. **Supabase:** new project under a club account with credentials in the shared
   password manager. Let the Supabase migration runner apply the complete migration
   history to a disposable database first; do not manually guess ordering from the
   mixture of numbered and timestamped filenames. Never apply SQL under
   `supabase/proposals`. `seed.sql` is
   only for an empty bootstrap project and inserts a demo row; do not run it in a
   populated production project.
3. **Auth:** enable email/password only; disable signups (officers are invited via dashboard); insert each officer's `auth.users.id` into `officers`.
4. **Vercel:** import the repo (club Vercel account, hobby tier). Env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SECRET_KEY` (server-only; never `NEXT_PUBLIC_`)
   - `CRON_SECRET` (Production-only, at least 32 characters)
   - the five `GOOGLE_*` variables from `.env.example` when direct Sheet sync is used

   Keep privileged Supabase, cron, Google, model, and notification credentials
   out of Preview. Optional pipeline and weekly-digest variables are documented
   in `.env.example`, `docs/15-operational-pipeline.md`, and
   `docs/weekly-review-notifications.md`.
5. **Domain:** subdomain of the club site, e.g. `careers.csulbbiotech.org`, CNAME → Vercel. Existing website adds a nav link + optionally embeds exported JSON/CSV.

## Ongoing operation
- Deploys: merging `main` triggers the production Vercel build. Automatic branch
  deployments are disabled in `vercel.json`; create a supervised preview only
  when the change requires one.
- Schema changes: add a new migration and commit it in the same PR as the code
  that needs it. Apply it as an explicit production rollout after the clean
  database workflow passes; never edit a migration already applied to production.
- Backups: Supabase free tier has limited backups — add a monthly manual export (admin Export page → commit CSV to a private repo or Drive) to the officer checklist.
- Cost: $0 (Supabase free + Vercel hobby). If the project pauses from inactivity (free-tier behavior), any visit restores it; document this in HANDOFF.md so nobody panics.

## Handoff (each officer transition)
1. Transfer/verify GitHub org membership, Vercel team, Supabase org access, shared credentials entry.
2. New officer runs the app locally once (README quickstart) and performs one
   private test import without publishing it.
3. Review HANDOFF.md together: weekly review-queue routine, monthly export/backup, semester report generation, "who to call" list.

## Local development
`cp .env.example .env.local`, fill keys from Supabase dashboard, `npm ci`,
`npm run dev`. Day-to-day app development may point at a non-production Supabase
project; migration pull requests are also tested against the disposable local
database in the **Database contracts** workflow.
