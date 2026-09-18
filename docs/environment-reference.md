# Environment reference

`.env.example` is the variable-name authority. This document explains scope and
operational intent without containing credential values.

## Core application

| Variable | Required | Exposure | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser-safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser-safe | Restricted anonymous client key |
| `NEXT_PUBLIC_SITE_URL` | Production auth | Browser-safe | Canonical origin for recovery redirects behind a proxy |
| `SUPABASE_SECRET_KEY` | Officer and worker operations | Server-only, Production | Current privileged Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | Legacy fallback only | Server-only, Production | Temporary compatibility name |
| `CRON_SECRET` | Scheduled routes | Server-only, Production | Bearer authentication for Vercel cron |
| `PIPELINE_BATCH_LIMIT` | No | Server-only | Bounds work claimed by one pipeline run |
| `PIPELINE_SHEET_SYNC_LIMIT` | No | Server-only | Bounds candidates considered by one Sheet handoff |

Never add a `NEXT_PUBLIC_` prefix to a privileged value. Preview environments
must not receive either privileged Supabase key.

## Google Sheet review mirror

| Variable | Required when enabled | Purpose |
| --- | --- | --- |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Yes | Fixed workbook |
| `GOOGLE_SHEETS_RANGE` | Yes | Bounded Review Queue range |
| `GOOGLE_SHEETS_ARCHIVE_RANGE` | No | Bounded Archive range |
| `GOOGLE_SHEETS_SOURCE_RECORD_ID` | Yes | Fixed provenance record |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | Workbook-scoped service account |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Yes | Server-only service account key |

The service account should be Editor on only the intended workbook. Browser
input must never choose the workbook, credentials, or publication state.

## Discovery and source access

| Variable | Activation rule |
| --- | --- |
| `DISCOVERY_SEARCH_ENABLED` | Must be explicitly `true` |
| `BRAVE_SEARCH_API_KEY` | Required for indexed-web discovery |
| `BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED` | Must be explicitly `true` before storing results |
| `EMPLOYER_DISCOVERY_BATCH_SIZE` | Optional bounded employer batch |
| `EMPLOYER_DISCOVERY_RESULTS_PER_QUERY` | Optional bounded result count |
| `LANE_DISCOVERY_BATCH_SIZE` | Optional bounded taxonomy-lane batch |
| `USAJOBS_API_KEY` | Required for governed USAJOBS sources |
| `USAJOBS_REGISTERED_EMAIL` | Required with the USAJOBS key |

## Optional extraction and scraping

| Variable | Purpose |
| --- | --- |
| `PIPELINE_MODEL_ENABLED` | Enables private model extraction |
| `PIPELINE_MODEL_NAME` | Selects the configured model |
| `PIPELINE_MODEL_BASE_URL` | Defaults to the local OmniRoute endpoint |
| `PIPELINE_MODEL_API_KEY` | Server-only model credential when required |
| `PIPELINE_ALLOW_REMOTE_MODEL` | Explicitly allows a nonlocal model endpoint |
| `PIPELINE_SCRAPLING_ENABLED` | Enables the private-worker Scrapling fallback |
| `SCRAPEGRAPH_API_KEY` | Enables the hosted text fallback |
| `SCRAPEGRAPH_MONTHLY_BUDGET` | Bounds hosted fallback use |

Remote model use requires both an enabled model and explicit remote opt-in.
These services remain advisory and cannot publish.

## Weekly review digest

| Variable | Purpose |
| --- | --- |
| `GMAIL_CLIENT_ID` | Gmail OAuth client |
| `GMAIL_CLIENT_SECRET` | Gmail OAuth secret |
| `GMAIL_REFRESH_TOKEN` | Gmail refresh credential |
| `REVIEW_DIGEST_RECIPIENTS` | Protected officer recipient list |
| `REVIEW_DIGEST_FROM` | Approved sender address |
| `REVIEW_DASHBOARD_URL` | Link placed in the digest |

Keep addresses and OAuth credentials in the protected GitHub `production`
environment. Do not commit them or expose them to pull requests.

## Runtime-provided and command-only variables

The code also reads platform or command-scoped values such as `VERCEL_ENV`,
`VERCEL_PROJECT_PRODUCTION_URL`, `GITHUB_RUN_ID`, `PIPELINE_WORKER_ID`,
`PIPELINE_PYTHON`, `SOURCE_IDENTIFIER`, `SUPABASE_URL`, and diagnostic overrides.
These are supplied by Vercel, GitHub Actions, or a specific maintainer command
and do not belong in the normal `.env.example` setup.

## Verification

Run `npm run ops:doctor` in the intended private environment after credential
rotation or production configuration changes. It validates configuration without
printing secret values or changing records.
