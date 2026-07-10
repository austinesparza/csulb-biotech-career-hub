# Q. MVP Build Plan · R. Risks & Edge Cases

## Q. Build plan (one developer, part-time; issues from docs/10)

**M1 — MVP (weeks 1–4): Issues 1–13.**
Week 1: repo, Supabase, deploy, auth (1–4). Week 2: import pipeline against the real spreadsheet (5–7). Week 3: review queue, duplicates/reposts, approved-record protection test, statuses (8–11). Week 4: board polish, export, HANDOFF.md (12–13). **Gate:** the acceptance test in docs/02 passes with real data, including the re-import-changes-nothing check.

**M2 (weeks 5–6): Issues 14–15.** Submissions + company directory.
**M3 (weeks 7–9): Issues 16–17.** People/consent, then the four content pages.
**M4 (week 10+): Issues 18–20.** Reports, sweeps, hygiene. Ship the semester report before finals — it's the club's ROI proof.

Rules: deploy from week 1 and demo on production; import the real spreadsheet in week 2, not with fabricated test data — the real mess drives the normalizer; write HANDOFF.md during M1, not after.

## R. Risks and edge cases

**Sustainability (highest risk)**
- *Builder graduates, app rots.* Mitigations baked in: org-owned GitHub/Vercel/Supabase, HANDOFF.md acceptance-tested by a non-author (Issue 13), boring stack, no exotic deps, docs in-repo.
- *Nobody reviews; queue rots; board goes stale.* Stale data is worse than no app. Mitigations: weekly routine is ~25 min; dashboard counts shame-visible; `last_checked_at` shown publicly so staleness is at least honest; stale sweeps (Issue 19).
- *Free-tier project pauses on inactivity.* Documented in HANDOFF.md; any visit restores it.

**Data integrity**
- *Re-import silently mutating reviewed listings.* Closed by design: approved+public records get `last_seen_at` only; changes become `import_changed` tasks (Issue 10 tests this explicitly).
- *Messy real spreadsheet* (merged cells, multiple header rows, "see notes" in date columns, impossible dates like 2/31). Mitigations: strict calendar validation, lossless raw storage, per-row errors that don't abort the run, header confirm screen, dry-run.
- *Dedupe false positives/negatives.* Fuzzy and family matches never auto-merge; recurring cycles ("Summer 2026" → "Fall 2026") produce new records flagged `possible_repost`, not updates. Thresholds tuned on real data (Issue 9); worst case is a duplicate pair both visible until an officer resolves — annoying, not harmful.
- *Company name churn* ("Acme", "Acme Inc.", "Acme Biosciences"). Suffix stripping catches most; fuzzy task catches the rest; officers can rename the canonical company.
- *Rolling deadlines* never expire automatically — the 30-day unverified sweep is what retires them.
- *Timezone/date ambiguity:* dates stored as `date` (no TZ); deadline display is date-only; ambiguous or invalid parses keep original text visible in `deadline_text`.

**Privacy/safety**
- *Private notes leak.* Structurally prevented (views); imported spreadsheet notes default to `private_notes`; the export endpoint reads the public view, not base tables. Issue 8 AC: private_notes never rendered publicly.
- *Person published without consent.* consent_check tasks + checklist; default `public_safe=false` everywhere.
- *Missing provenance.* Imports without a source record are rejected; the DB requires `source_record_id` on every import run.
- *Spam submissions.* Honeypot + length limits; submissions are never public without review; purge routine. If spam grows, add Cloudflare Turnstile (free) later.
- *Filter-input injection into PostgREST.* All student-facing filter input passes `sanitizeSearchTerm` (strips `,()%_\.`); sort/paid params are allowlisted.
- *Implied endorsement / bad posting.* Disclaimer footer; "report a problem" path via /submit; officers can hide instantly (no deploy).

**Scope/behavioral**
- *Temptation to add scraping later.* The architecture has no fetch-external-site code path on purpose; `source_records.refresh_policy` documents the manual process per source. Keep it that way — restricted platforms are handled only via manually entered links and reviewed submissions.
- *Feature creep (student accounts, chat, notifications).* The MVP gate and this doc are the defense: every new feature must name the officer-hours it costs per week to maintain.

**Technical**
- *Import of a huge/wrong file.* Row-by-row inserts are fine to ~2k rows; beyond that batch inserts (known improvement, noted in code). Wrong file → header mapping fails loudly, nothing written except the failed run record.
- *Service-role misuse.* Convention: `createServiceClient()` only after `requireOfficer()`; check in every admin-action PR review.
- *Supabase API changes / Next.js major bumps.* Pin majors; upgrade once a year deliberately (HANDOFF.md).
- *Lost officer access.* At least two officers + one faculty/alumni advisor hold Supabase org ownership.
