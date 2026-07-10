# K. Student-Facing UI Plan

Design principle: boring, fast, readable. Tailwind, no component library, server components everywhere, zero client JS except search/filter inputs. Every page reads only `public_*` views; all user filter input is sanitized (`sanitizeSearchTerm`).

## Pages

**1. `/` Career Hub landing** — Hero + four cards (Internships, Companies, Mentors, Resources), count badges ("42 open internships"), latest 5 approved postings, link back to the main club site. Nav mirrors the existing site's sections so it feels like an extension, not a separate app.

**2. `/internships` Internship Exchange (MVP core)** — Search box (title/company), filters: focus area, paid status, location text, "deadline after" date, application type. Sort: relevance (default), deadline, newest. Card shows: company, title, location, focus area, paid badge, deadline (red if <14 days), eligibility, public notes, **"Apply at source →"** link (`rel="noopener nofollow"`), and footer line: `Source: <source name> · Last checked <date> · Unverified?`. Empty state links to /submit.

**3. `/companies` Company Directory** — Alphabetical grid; company page lists its open approved postings + past postings count. (M2)

**4. `/pathways` Career Pathways** — One page per `career_paths` row: description, typical roles, linked resources and current openings tagged with that focus area. (M3)

**5. `/mentors` Mentor Network** — Cards from `public_mentors` view: name, affiliation, focus areas, "ask me about". Contact shown only when `contact_public`; otherwise a "request intro via an officer" mailto. (M3)

**6. `/speakers` Speaker Library** — Past Distinguished Speaker Series events: title, speaker, date, recording/slides links where consented. (M3)

**7. `/resources` Resource Library** — Filterable list by type/tag/pathway; mirrors "Career & Club Resources" and "Resource posts" on the existing site. (M3)

**8. `/submit` Submit an Opportunity** — Public form → `user_submissions` insert (honeypot field + length limits, no captcha for MVP). Confirmation: "Thanks — an officer will review before anything is published." (M2)

**9. `/about` About the Career Hub** — How records get here (import → officer review → publish), what the statuses mean, disclaimer: *listings are shared for information; inclusion is not an endorsement by the club or CSULB*, and how to report a bad link. (M1, one static page)

## Admin dashboard (`/admin`)
- **Home:** counts — needs_review, open review_tasks, postings expiring in 14 days, broken links, new submissions.
- **Import:** upload CSV + required source selector → header-mapping confirm screen → dry-run preview (insert/update/duplicate/error per row) → commit → run summary showing touched-vs-updated split for approved records.
- **Review queue:** table sorted by relevance desc; row expands to full edit form; shows `private_notes` (imported spreadsheet notes) with a "copy sanitized text to public notes" affordance; one-click actions: Approve, Reject, Duplicate-of…, Mark checked (sets `last_checked_at`, flips unverified→verified), Hide, Expire. `import_changed` tasks show a field-level diff between the approved record and the latest import row.
- **Duplicates/reposts:** side-by-side compare, pick survivor, loser gets `status=duplicate, duplicate_of=survivor`; repost tasks default to "keep both" since new cycles are usually legitimate new postings.
- **Companies / People / Resources:** simple CRUD lists with public-safe + consent toggles.
- **Export:** filter → download CSV/JSON of approved records.
- **Reports:** pick semester range → generated stats preview → save `semester_reports`. (M4)
