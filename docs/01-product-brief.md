# A. Product Brief — CSULB Biotech Career Hub

**One line:** A student-maintained web app that turns the club's internship spreadsheet into a reviewed, searchable career board, plus directories for companies, mentors, speakers, career pathways, and resources.

## Problem
The club tracks internships in a spreadsheet. It goes stale, duplicates accumulate, dead links persist, and students can't filter or trust what they see. Mentor/alumni/speaker info lives across website pages with no consistent consent or visibility controls. Each officer transition loses institutional knowledge.

## Solution
A Next.js + Supabase app where:

1. Officers import the existing spreadsheet via CSV. Rows are stored raw, normalized into a database, deduplicated, and queued for review.
2. Nothing appears publicly until an officer approves it and marks it public-safe — and once approved, imports can never silently change it.
3. Students browse a searchable Internship Exchange showing only reviewed, current, public-safe postings — each with source and last-checked date.
4. The same review pattern extends to companies, mentors, alumni, speakers, and resources.
5. Approved records export as CSV/JSON for embedding in the existing club website.

## What this app deliberately is NOT
- Not a scraper. No automated collection from job boards or any site that prohibits automated access. Data enters only via CSV import, manual entry, or voluntary submissions — all officer-reviewed.
- Not a student-account system in v1. Students browse anonymously; only officers log in.
- Not a replacement for the club website. It extends it and exports content back to it.

## Users
| User | Needs |
|---|---|
| Students | Find current, relevant, trustworthy internships and resources fast |
| Officers | Import, review, dedupe, publish, and retire records with low effort |
| Mentors/alumni/speakers | Submit updates; control what's public about them |
| Future officers | A documented system they can run without the original builder |

## Success measures (per semester)
Postings imported and approved, dead-link rate on the public board, submissions received, student page views, and a generated Semester Impact Report.

---

# S. Final Recommendation — Minimum Version Worth Building First

Build **only** this, end to end, before anything else:

1. Supabase schema (migration `0001_init.sql`) with RLS and public views.
2. Officer login (Supabase email auth + `officers` allowlist).
3. CSV import: upload → raw rows stored → normalize → dedupe → everything lands as `needs_review`. Every import requires a named source.
4. Review queue: approve / edit / mark duplicate / reject, set status and public-safe.
5. Public Internship Exchange page: search + filters over the `public_opportunities` view only.
6. CSV export of approved records.

That is MVP-complete: the spreadsheet becomes a trustworthy public board with an audit trail. Company Directory falls out nearly free (companies are created during import). **Defer** mentors, alumni, speakers, pathways, resources, submissions, scoring UI, and reports to post-MVP milestones — the schema already has their tables, so nothing is blocked later.

Rationale: the riskiest, highest-value loop is import → review → publish. If that loop works and is documented, every other module is just another table plus the same review pattern.
