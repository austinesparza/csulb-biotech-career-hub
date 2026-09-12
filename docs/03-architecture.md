# C. System Architecture

## Stack decision
**Keep the requested stack: Next.js (App Router) + Supabase + Vercel + TypeScript.** It is the right call for student-officer maintainability:

- Supabase gives Postgres, auth, RLS, and a web GUI (Table Editor) — officers can fix data without writing SQL. Free tier is sufficient.
- Vercel deploys on merges to `main`, serves the Next.js application, and runs
  two bounded cron routes. No separately managed application server is required.
- Next.js server components mean no separate API layer to maintain.

**Tradeoff considered:** Airtable/Google Sheets + a static site is simpler to *start* but fails the requirements — no real review workflow, no public/private column separation you can trust, no dedup, and the club already outgrew a spreadsheet. A Rails/Django app is more capable but assumes future officers know that framework; Next.js/TS is the most common student skill set. Conclusion: requested stack, minimal dependencies (no ORM — use `supabase-js` directly; no UI kit beyond Tailwind).

## Diagram

```
                ┌─────────────────────────────────────────┐
                │                Vercel                    │
                │  Next.js App Router                      │
                │                                          │
  Students ───▶ │  Public pages (anon)                     │
                │   /, /internships, /companies, ...       │
                │   read ONLY public_* views ──────────┐   │
                │                                      │   │
  Officers ───▶ │  /admin/* (auth-gated, proxy)        │   │
                │   import, review, dedupe, export     │   │
                │   server actions (service role) ──┐  │   │
                └────────────────────────────────────┼──┼──┘
                                                     │  │
                ┌────────────────────────────────────▼──▼──┐
                │               Supabase                    │
                │  Postgres + RLS                           │
                │   base tables: officers only              │
                │   public_* views: anon SELECT only        │
                │  Auth: email/password, officers allowlist │
                └───────────────────────────────────────────┘

  Sheet/CSV ── officer-triggered private intake → review queue
  Sources   ── governed cron/manual fetch → raw archive → review queue
  CSV out   ── /api/export → officer backup
```

## Key boundaries
1. **Anon key can only read `public_*` views.** Base tables have RLS = officers only. Private notes physically cannot leak because the views don't include those columns.
2. **Writes go through server actions** running with the service-role key on the server only (never shipped to the browser). Convention, enforced in code review: **no server action may call `createServiceClient()` before `await requireOfficer()` has succeeded.**
3. **External data has three governed entry paths.** Officers can sync the fixed
   Google Sheet or upload CSV, the public can submit a narrowly validated private
   lead, and workers can fetch only enabled `job_sources` with recorded terms and
   robots review. Every path preserves provenance and creates private review work.
   LinkedIn and login-gated pages remain lead/manual sources, not automated fetches.
4. **Approved public records are import-immutable.** Re-imports may only refresh `last_seen_at`; field changes become review tasks (see docs/08).

## Request flows
- **Student board:** server component → `select * from public_opportunities` with sanitized filters → render. Cacheable, no auth.
- **Import:** officer uploads CSV + selects source → server action parses (papaparse) → `import_runs` row → `raw_import_rows` bulk insert → normalize → dedupe → upsert as `needs_review` (or touch-and-flag for approved records) → `review_tasks` created → summary UI.
- **Direct Sheet sync:** an officer action reads one configured workbook and
  bounded range, filters template-only rows, then enters the same import pipeline.
  Governed machine candidates can be written back to system-owned columns; final
  database decisions move their rows to the fixed Archive tab.
- **Governed source run:** authenticated cron or officer action claims a bounded
  source run → safe fetch → immutable payload/version archive → deterministic
  classification and optional evidence-bound extraction → private review task.
- **Review:** officer edits/approves → status + `review_status` + `public_safe` updated → appears on board on next request.
- **Export:** `/api/export?format=csv` (officer-authed) streams the public view.

---

# N. Repository Structure

```
csulb-biotech-career-hub/
├── README.md                  # setup + deliverable map + invariants
├── HANDOFF.md                 # officer runbook (finished in M1)
├── docs/                      # design docs (this folder)
├── supabase/
│   ├── migrations/            # executable, ordered schema history
│   └── seed.sql
├── src/
│   ├── app/
│   │   ├── layout.tsx, page.tsx, globals.css   # landing
│   │   ├── internships/page.tsx                # student board
│   │   ├── companies/page.tsx                  # M2
│   │   ├── submit/page.tsx                     # M2
│   │   ├── admin/
│   │   │   ├── page.tsx                        # dashboard
│   │   │   ├── import/page.tsx + import-form.tsx + actions.ts
│   │   │   ├── review/page.tsx + actions.ts    # Issue #8
│   │   │   └── login/page.tsx
│   │   └── api/export/route.ts
│   ├── lib/
│   │   ├── types.ts           # F: all entity + enum types
│   │   ├── normalize.ts       # field cleaning/parsing/sanitizing
│   │   ├── csvImport.ts       # G: header mapping, row → draft, keys
│   │   ├── dedupe.ts          # H: matching + update policy
│   │   ├── relevance.ts       # I: scoring
│   │   └── supabase/
│   │       ├── client.ts      # browser (anon)
│   │       └── server.ts      # server (service role / cookie auth)
│   └── proxy.ts               # gate /admin/*
├── package.json  tsconfig.json  next.config.mjs  postcss.config.mjs
├── .env.example  .gitignore
└── .github/ISSUE_TEMPLATE/ (optional)
```

Conventions for maintainability: one migration file per change, never edit old migrations (pre-deploy, `0001` may still be amended); all business logic in `src/lib/` as pure functions with no framework imports (testable in isolation); every enum defined once in SQL and mirrored once in `types.ts`.
