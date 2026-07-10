# M. Deployment Plan

## One-time setup (~1 hour, documented for handoff)

1. **GitHub:** create org-owned repo (club GitHub org, not a personal account — critical for handoff). Protect `main`; PRs required.
2. **Supabase:** new project (free tier) under a club email (e.g. csulbbiotech.dev@gmail.com with shared password manager entry). Run `supabase/migrations/0001_init.sql` via SQL editor or `supabase db push`. Run `seed.sql` for career paths + demo data.
3. **Auth:** enable email/password only; disable signups (officers are invited via dashboard); insert each officer's `auth.users.id` into `officers`.
4. **Vercel:** import the repo (club Vercel account, hobby tier). Env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never `NEXT_PUBLIC_`)
5. **Domain:** subdomain of the club site, e.g. `careers.csulbbiotech.org`, CNAME → Vercel. Existing website adds a nav link + optionally embeds exported JSON/CSV.

## Ongoing operation
- Deploys: push to `main` → Vercel builds. Preview deploys on PRs.
- Schema changes: new numbered migration file, applied via SQL editor, committed in the same PR as the code that needs it.
- Backups: Supabase free tier has limited backups — add a monthly manual export (admin Export page → commit CSV to a private repo or Drive) to the officer checklist.
- Cost: $0 (Supabase free + Vercel hobby). If the project pauses from inactivity (free-tier behavior), any visit restores it; document this in HANDOFF.md so nobody panics.

## Handoff (each officer transition)
1. Transfer/verify GitHub org membership, Vercel team, Supabase org access, shared credentials entry.
2. New officer runs the app locally once (README quickstart) and performs one test import on a branch.
3. Review HANDOFF.md together: weekly review-queue routine, monthly export/backup, semester report generation, "who to call" list.

## Local development
`cp .env.example .env.local`, fill keys from Supabase dashboard, `npm install`, `npm run dev`. No Docker required (point local dev at the hosted Supabase project; the club scale doesn't justify local Postgres).
