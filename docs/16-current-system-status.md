# Current system status

**Authoritative status date:** September 16, 2026  
**Production data snapshot:** September 15, 2026 at 07:39 UTC  
**Audited repository baseline:** `6c4ad118a3a79ad7cb311e87a662bdd2425b6dda`

This file is the current status authority for the Career Hub. Earlier design and launch documents explain how the project developed, but their counts, audience assumptions, and rollout states may be historical. When a historical document conflicts with this file, current code, migrations, production data, and live behavior take precedence.

## Product definition

The CSULB Biotech Career Hub is a student-maintained, officer-reviewed opportunity system for undergraduate and graduate students interested in biotechnology and related life-science careers.

It is not a single scraper. It accepts evidence through several private intake paths, preserves the original evidence, normalizes and matches it, and requires an authenticated officer decision before publication. Public database views independently enforce the publication rules.

## Current production snapshot

| Measure | Current value |
| --- | ---: |
| Public opportunities | 19 |
| Public employers | 14 |
| Public focus areas | 8 |
| Total opportunities | 202 |
| Total employers | 49 |
| Open review tasks | 22 |
| Raw imported rows | 1,060 |
| Automated job sources | 3 |
| Normalized source postings | 55 |
| Immutable posting versions | 74 |
| Discovery leads | 25 |
| Model extractions | 0 |
| Active officers | 1 |

The 19 public opportunities include undergraduate, graduate, and mixed-audience roles. Seventeen are marked paid and two have unknown compensation. No public role had a past deadline or a source-check timestamp older than 14 days at the snapshot time.

## Capability status

| Capability | Status | Evidence |
| --- | --- | --- |
| Public opportunity board | Active | Live site reads 19 gated records |
| Officer authentication and review | Active | Review queue, revision history, and one active officer |
| CSV import | Active | 11 import runs and 1,060 archived rows |
| Google Sheet import | Working manually | Recent 24-row and 26-row update batches completed without errors |
| Automated Sheet sync in the canonical cycle | Implemented, currently off | Observed production cycles record Sheet sync disabled |
| Quick add | Active | Officer-only private draft workflow |
| Public submissions | Active, currently unused | Validated private intake exists; zero pending submissions |
| Greenhouse source automation | Active | Three enabled, healthy 24-hour sources |
| Lever, Ashby, USAJOBS, static HTML, schema.org | Implemented, not production-proven | Code and tests exist; no enabled production examples |
| RSS and generic API source kinds | Registered, not runnable | Canonical connector runner does not process them |
| Indexed-web agentic discovery | Implemented, currently off | Brave Search provider, rotating employer and scientific-lane plans, private lead archive, and 25 historical leads; recent cycles disabled |
| Indexed LinkedIn discovery | Implemented, currently off | Every employer and scientific-lane plan includes LinkedIn job and hiring-post queries; activation requires a search plan with storage rights and production configuration |
| Direct LinkedIn crawling | Not implemented, permission-gated | No automated worker logs in, reuses member sessions, bypasses controls, or requests LinkedIn pages directly |
| ScrapeGraphAI fallback | Implemented, optional | Raw text fallback for approved static pages only |
| Model extraction | Experimental, off | Zero production extraction records |
| Automatic publication | Intentionally absent | Officer decision and public-view gate required |
| Automatic closure or unpublish | Intentionally absent | Missing evidence creates a review task |
| Weekly review email | Active when configured | Latest scheduled workflow completed successfully |
| Vercel primary cron | Configured, ownership not independently verified | No attributable Vercel-origin cycle in the audited history |
| GitHub recovery cron | Active | A successful recovery invocation matches the latest production cycle |
| Mentorship, events, semester reports | Data model only | Empty tables and no complete public workflow |
| Offline installation | Not implemented | No service worker or web-app manifest |

## Active automated sources

As of September 25, the two enabled sources use the public Greenhouse Job Board API:

- Ginkgo Bioworks
- Xaira Therapeutics

Flagship Pioneering Co-Op Program is disabled and paused because its entire board is restricted to Northeastern University students. Earlier reviews and source observations remain private for the audit trail; its seven pending drafts and 23 tasks are archived or resolved by the source-policy cleanup.

## Publication boundary

An opportunity becomes public only when all applicable controls pass:

1. An active officer approves it through the audited decision procedure.
2. `review_status` is `approved`.
3. `public_safe` is true.
4. Status is `open_verified` or `open_unverified`.
5. The employer is public-safe.
6. Audience and graduate-stage values form an allowed combination.
7. Eligibility is `confirmed` or `possible`.
8. The restricted public view admits the row.

Automated source runs, search results, model output, public submissions, CSV rows, and Google Sheet decisions cannot bypass this boundary.

## Current operational risks

1. One active officer is a continuity and recovery risk. The operating target is two active officers and one advisor.
2. The GitHub repository remains under a personal account. The live Vercel project ownership and cron state were not independently confirmed from the connected club team.
3. Supabase reports seven security-definer view errors, a public-schema extension warning, an authenticated security-definer function warning, and leaked-password protection disabled.
4. Duplicate marking is not atomic and does not create the same durable decision audit as normal review actions.
5. The canonical static-page fetch path does not currently preserve conditional-request validators and treats HTTP 304 as failure.
6. CSV upload has no explicit byte or row ceiling.
7. Public-submission retention is not defined as a fixed schedule.
8. Visible hero and footer imagery relies on third-party CSS background URLs. The local footer asset is the older Purkinje-cell image and is hidden.
9. Pipeline cycle records do not distinguish Vercel from GitHub scheduler origin.
10. Several older documents describe graduate-only scope, disabled sources, automatic expiration, offline installation, or reports that do not match production.

## Graphify maintainer graph

Graphify is development-only and has no production credentials or publication authority. Version 0.9.62 is pinned. The current deterministic code graph contains:

| Graph measure | Value |
| --- | ---: |
| Code files indexed | 312 |
| Nodes | 2,049 |
| Edges | 4,260 |
| Communities | 144 |
| Dangling endpoints | 0 |
| Exact duplicate edges | 0 |

The generated `graphify-out/` directory is intentionally ignored by Git. Build it locally with `npm run graphify:build`, validate it with `npm run graphify:check`, and query it through the npm scripts before broad architecture or impact work.

## Documentation authority order

1. Executable migrations, current application code, and tests
2. Verified production state and live behavior
3. This current-status document
4. `HANDOFF.md` and `docs/15-operational-pipeline.md`
5. Earlier numbered design, launch, issue, and research documents

Historical documents should not be deleted because they preserve decisions and unbuilt options. They must not be used as evidence that a feature is active.

## Next governing document

The phased improvement program, acceptance gates, and expansion decisions are defined in [17-capability-roadmap.md](17-capability-roadmap.md).
