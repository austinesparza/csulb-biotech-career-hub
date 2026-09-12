# CSULB Biotech Career Hub

A student-maintained career opportunity tracker for undergraduate and graduate
biotechnology students. Officers review spreadsheet imports, voluntary submissions,
and candidates collected from explicitly approved public sources before anything
reaches the searchable board.

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

1. Create a club-owned Supabase project. Apply every executable file in
   `supabase/migrations/` in numeric order, then run `supabase/seed.sql`.
   Never run files under `supabase/proposals/`.
2. Auth → create officer users (invite; signups disabled). Insert each into `officers`:
   `insert into officers (user_id, display_name) values ('<auth uid>', 'Name');`
3. `cp .env.example .env.local` and fill keys (Supabase → Settings → API).
4. `npm ci && npm run dev` → http://localhost:3000. Sign in at `/admin/login`, then use `/admin/import`. CSV works immediately; direct Sheet sync requires the five server-only Google variables documented in `.env.example` and `docs/12-sheets-integration.md`.
5. Deploy: push to GitHub → import in Vercel → configure the required Supabase
   variables. Add the production-only cron and Google Sheet variables before
   using scheduled ingestion or direct Sheet sync. See `docs/07-deployment.md`.

## Deliverable map

| Deliverable | Location |
|---|---|
| A. Product brief · S. Final recommendation | `docs/01-product-brief.md` |
| B. MVP scope | `docs/02-mvp-scope.md` |
| C. Architecture · N. Repo structure | `docs/03-architecture.md` |
| D. Database schema design | `docs/04-database-schema.md` |
| E. Supabase SQL schema | ordered `supabase/migrations/*.sql` (+ `seed.sql`) |
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

Architecture ownership is mapped in `docs/pipeline-integration.md`. The small
root `normalize`/`dedupe` modules remain the CSV and opportunity bridge; the
`ingestion/` namespace owns source acquisition and persistence; `pipeline/`
owns evidence-bound classification/extraction experiments. Do not add a fourth
path.

1. Public pages read only `public_*` views. Never query base tables from a student-facing page.
2. Nothing becomes public without `review_status='approved'` + `public_safe=true`, set by an officer.
3. **Approved public records are import-immutable.** Re-imports may only refresh `last_seen_at`; field differences open `import_changed` review tasks. Published listings change only by officer action.
4. Every CSV import requires a `source_record`. Provenance is not optional.
5. Imported spreadsheet notes land in `private_notes`. Only officer-written text goes in `public_notes`.
6. Automated retrieval is limited to enabled `job_sources` that have recorded
   policy and robots checks. Prohibited or uncertain sources stay manual.
7. Officer server actions call `createServiceClient()` only after `requireOfficer()`.
   The sole public exception is the narrow, validated, rate-limited submission RPC;
   it can create private submissions but cannot publish or modify opportunities.
8. All user-supplied filter/search input passes `sanitizeSearchTerm()` before reaching a query.
9. Enums live in the SQL migration and `src/lib/types.ts` — change both in the same PR.
10. `SUPABASE_SECRET_KEY` is server-only; it must never gain a `NEXT_PUBLIC_`
    prefix. `SUPABASE_SERVICE_ROLE_KEY` is a temporary legacy fallback only.
11. Google Sheet intake and review handoff use fixed queue and archive ranges and
    a fixed source UUID. The Editor service account can update only the configured
    workbook; browser input can never choose it or authorize publication.

## For future officers
Start with `HANDOFF.md` (operational runbook), then `docs/01` and `docs/02`.


### Continuous discovery

Governed sources can run from the daily Vercel schedule or from officer
controls. Results are archived in Supabase and synchronized to the officer
Review Queue Sheet. See
[scheduled Sheet ingestion](docs/scheduled-sheet-ingestion.md).
