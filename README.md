# CSULB Biotech Career Hub

A student-maintained career-resource and internship-tracking platform. Officers import the club's internship spreadsheet, review and deduplicate records, and publish an approved, searchable board. No scraping — data enters only via CSV import, manual entry, or voluntary reviewed submissions.

## Publishing to GitHub (like the alumni hub, plus a backend)

The alumni hub runs on GitHub Pages because it is a static site. The Career Hub
has a database and officer login, so the code lives on GitHub while the app runs
on Vercel (free, deploys automatically on every push, same workflow feel as Pages).

```bash
# this folder is already a git repo with an initial commit
git remote add origin https://github.com/<account-or-org>/csulb-biotech-career-hub.git
git push -u origin main
```

Then follow LAUNCH.md: Supabase (Phase 2) → Vercel import (Phase 3) → real data
(Phase 4). Recommendation: create the repo under a club GitHub org rather than a
personal account so it survives officer transitions; the alumni hub on a personal
account is exactly the handoff risk to avoid repeating.

## Quickstart

1. Create a Supabase project (club account). SQL editor → run `supabase/migrations/0001_init.sql`, then `supabase/seed.sql`.
2. Auth → create officer users (invite; signups disabled). Insert each into `officers`:
   `insert into officers (user_id, display_name) values ('<auth uid>', 'Name');`
3. `cp .env.example .env.local` and fill keys (Supabase → Settings → API).
4. `npm install && npm run dev` → http://localhost:3000. Sign in at `/admin/login`, import a CSV at `/admin/import` (a source must be selected — seed.sql creates "Club Internship Spreadsheet").
5. Deploy: push to GitHub → import in Vercel → set the same three env vars. See `docs/07-deployment.md`.

## Deliverable map

| Deliverable | Location |
|---|---|
| A. Product brief · S. Final recommendation | `docs/01-product-brief.md` |
| B. MVP scope | `docs/02-mvp-scope.md` |
| C. Architecture · N. Repo structure | `docs/03-architecture.md` |
| D. Database schema design | `docs/04-database-schema.md` |
| E. Supabase SQL schema | `supabase/migrations/0001_init.sql` (+ `seed.sql`) |
| F. TypeScript types | `src/lib/types.ts` |
| G. CSV import design + code | `docs/08-import-dedupe-scoring.md`, `src/lib/csvImport.ts`, `src/app/admin/import/actions.ts` |
| H. Deduplication | same doc, `src/lib/dedupe.ts` |
| I. Relevance scoring | same doc, `src/lib/relevance.ts` |
| J. Admin review workflow | `docs/09-review-workflow.md` |
| K. Student-facing UI plan | `docs/05-ui-plan.md` |
| L. Public/private data policy | `docs/06-data-policy.md` |
| M. Deployment plan | `docs/07-deployment.md` |
| O. Initial implementation files | `src/**`, config files |
| P. First 20 GitHub issues | `docs/10-github-issues.md` |
| Q. Build plan · R. Risks | `docs/11-build-plan-risks.md` |

## Non-negotiable invariants (read before contributing)

1. Public pages read only `public_*` views. Never query base tables from a student-facing page.
2. Nothing becomes public without `review_status='approved'` + `public_safe=true`, set by an officer.
3. **Approved public records are import-immutable.** Re-imports may only refresh `last_seen_at`; field differences open `import_changed` review tasks. Published listings change only by officer action.
4. Every CSV import requires a `source_record`. Provenance is not optional.
5. Imported spreadsheet notes land in `private_notes`. Only officer-written text goes in `public_notes`.
6. No code that fetches data from external sites. Sources are refreshed manually per `source_records.refresh_policy`.
7. No server action calls `createServiceClient()` before `await requireOfficer()` succeeds.
8. All user-supplied filter/search input passes `sanitizeSearchTerm()` before reaching a query.
9. Enums live in the SQL migration and `src/lib/types.ts` — change both in the same PR.
10. `SUPABASE_SERVICE_ROLE_KEY` is server-only; it must never gain a `NEXT_PUBLIC_` prefix.

## For future officers
Start with `HANDOFF.md` (operational runbook), then `docs/01` and `docs/02`.
