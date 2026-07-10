# G. CSV Import Design · H. Deduplication Logic · I. Relevance Scoring

Implementations: `src/lib/csvImport.ts`, `src/lib/dedupe.ts`, `src/lib/relevance.ts`, `src/app/admin/import/actions.ts`.

## G. CSV import pipeline

```
CSV upload (officer) + REQUIRED source selection
  → papaparse (header: true, skipEmptyLines)
  → mapHeaders(): alias table matches spreadsheet columns
      "Internship Title / Position" → title, "Paid / Unpaid" → paid_status, etc.
      Unmatched headers reported, never silently dropped from the audit trail
  → import_runs row created (who, when, filename, source)
  → per row:
      raw_import_rows insert (verbatim jsonb — permanent audit trail)
      rowToDraft(): validate (company+title required), normalize
        deadline: strictly validated calendar dates (2026-02-31 → rejected);
                  finds dates inside phrases ('open until 03/15/2026');
                  pure text ('Rolling'/'ASAP'/'TBD') → null, original kept in deadline_text
        paid: keyword rules → paid|unpaid|stipend|unknown
        url: http/https only, tracking params stripped, host lowercased
        notes: → private_notes (NEVER public by default)
      dedupe (below)
      relevance score computed + stored with reasons
      new rows: status='needs_review', review_status='pending', public_safe=false
  → import_runs updated with counts; source_records.last_imported_at stamped
```

Design choices: **idempotent** — re-importing the same file refreshes `last_seen_at` instead of duplicating; **lossless** — original strings preserved (`deadline_text`, `source_status_raw`, `raw` jsonb); **never auto-public** — every path lands in the review queue; **provenance mandatory** — imports without a source record are rejected. The importer does not interpret the spreadsheet's Status column into a public status; officers decide (`source_status_raw` is shown as a hint).

Failure handling: missing required columns → import aborts with a message naming the alias table to extend. Bad rows → recorded with `parse_status='error'` and shown in the summary; the run continues.

## H. Deduplication

Three tiers, one policy: **only URL/strict-key matches may act automatically, and even then only on non-public records. Family and fuzzy matches only flag.**

**Companies** — key: `normalizeCompanyName()` (lowercase, punctuation stripped, legal suffixes like Inc/LLC removed; stored as unique `name_normalized`). Exact → reuse. Fuzzy (bigram Dice ≥ 0.85) → reuse existing company but open a `possible_duplicate` review task naming both spellings. None → create.

**Opportunities** — matched in priority order:

1. **Same normalized `posting_url`** (strongest identity signal — checked first).
2. **Strict key** `company|full normalized title|url` — season/year KEPT, so "Summer 2026" and "Fall 2026" are different postings.
3. **Family key** `company|title with season/year stripped` — matches recurring cycles. Inserts a NEW row and opens a `possible_repost` task; never updates anything.
4. **Fuzzy title** (Dice ≥ 0.80, same company only) — inserts a new row + `possible_duplicate` task.

**Update policy for URL/strict matches** (`decideUpdatePolicy`) — the approved-record protection rule:

```
existing record NOT approved+public  → refresh imported fields + score
existing record approved AND public  → update last_seen_at ONLY;
                                       if any public-facing field differs
                                       (title, url, location, eligibility,
                                        focus_area, deadline(+text),
                                        paid_status, application_type,
                                        source_status_raw)
                                       → open import_changed review task
```

A routine re-import can therefore never silently alter a listing an officer already reviewed. Duplicates are never deleted — officer "mark duplicate" sets `status='duplicate', duplicate_of=<survivor>`. Similarity is dependency-free Dice on bigrams (pg_trgm indexes exist for future SQL-side search). Thresholds are constants in `dedupe.ts`; tune with real data during Issue #9.

## I. Relevance scoring

`scoreOpportunity(draft, config)` → `{score: 0–100, reasons: string[]}`. Baseline 40, then transparent additive rules:

| Signal | Points |
|---|---|
| Deadline in future ≤60d / >60d / rolling | +15 / +10 / +10 |
| Deadline ≤7d (urgent) | +5 |
| Deadline passed | −30 |
| No deadline info | −5 |
| Paid / stipend / unpaid | +15 / +10 / −5 |
| Location matches local/remote hints | +10 |
| No location | −3 |
| Eligibility matches undergraduates | +10 |
| Graduate-only | −15 |
| Priority focus area (club-configured list) | +10 |
| No application link | −10 |

Clamped to 0–100. `reasons` (e.g. `"+15: deadline in 42d"`) is stored in `relevance_reasons` so officers and future maintainers can see exactly why — no black box. The score **only sorts** (review queue and default board order); it never hides a record or substitutes for review. Config lives in one exported constant (`DEFAULT_CONFIG`); changing club priorities is a one-line PR.
