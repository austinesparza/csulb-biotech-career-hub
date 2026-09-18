# Operations reference

This document maps recurring work to its owner, interface, and recovery path.
Officer-facing steps remain in [`../HANDOFF.md`](../HANDOFF.md); this reference
adds the technical contract.

## Routine operations

| Operation | Trigger | Primary interface | Writes | Publishes? |
| --- | --- | --- | --- | --- |
| Review opportunities | Weekly and after intake | `/admin/review` | Review decisions and audit history | Only after officer approval |
| Correct a public record | Verified error or closure | `/admin/manage` | Audited revision | May update or remove one reviewed record |
| Sync officer Sheet | Officer action or pipeline handoff | `/admin/import` | Raw rows, drafts, tasks, queue/archive | No |
| Import CSV | Sheet outage or structured batch | `/admin/import` | Raw rows, drafts, tasks | No |
| Test a source | Before enablement or debugging | `/admin/sources` | Private run, evidence, review work | No |
| Run canonical pipeline | Daily or officer action | Vercel cron or `/admin/sources` | Private evidence and review work | No |
| Recover pipeline | Daily fallback or manual dispatch | GitHub Actions | Same bounded private cycle | No |
| Review digest | Monday | GitHub Actions | Email only | No |
| Export public data | As needed | `/api/export` | Download only | Reads public view |

## Scheduled jobs

| Owner | Schedule | Entry point | Failure signal |
| --- | --- | --- | --- |
| Vercel | `0 14 * * *` (daily 14:00 UTC) | `/api/cron/ingest` | Non-2xx response or partial cycle |
| GitHub recovery | `15 14 * * *` (daily 14:15 UTC) | `pipeline-recovery.yml` | Failed workflow or rejected auth |
| Vercel | `0 16 * * 1` (Monday 16:00 UTC) | `/api/cron/health` | Missing health tasks or non-2xx response |
| GitHub | `0 16 * * 1` (Monday 16:00 UTC) | `weekly-review-digest.yml` | Configuration warning or failed send |
| GitHub | `17 6 * * 1` (Monday 06:17 UTC) | `security.yml` | Security or drift check failure |

The recovery workflow must remain idempotent. A scheduler retry must not duplicate
active work or create a second publication route.

## Standard source onboarding

1. Add the source disabled.
2. Record the source owner, official URL, permitted method, terms review, robots
   review, and refresh policy.
3. Run **Test privately**.
4. Inspect the fetch run, raw evidence, normalized posting, version, draft, and
   review task.
5. Resolve connector or mapping errors before enablement.
6. Enable recurring use only after an officer accepts the evidence quality.
7. Monitor the first scheduled runs and source-health state.

Never enable a source because a connector technically succeeds. Governance and
evidence quality are separate acceptance gates.

## Standard release

1. Open a pull request from a preview branch.
2. Run `npm run docs:check` and the complete validation matrix.
3. Review the Vercel preview when application output changes.
4. Confirm the **Database contracts** workflow for migration changes.
5. Apply required migrations as an explicit production action.
6. Merge the approved commit to `main`.
7. Verify Vercel reports a successful production deployment.
8. Verify the affected public or officer workflow without creating test records
   that could be mistaken for real data.

## Recovery guide

| Symptom | First check | Safe response |
| --- | --- | --- |
| Public site unavailable | Vercel deployment and Supabase project state | Restore platform service; do not bypass public views |
| Cron returns 401 | Production `CRON_SECRET` scope and length | Rotate or correct the secret; never place it in a URL |
| Pipeline cycle remains running | Integrations page and worker lease age | Use bounded recovery; do not manually duplicate the run |
| Source repeatedly fails | Source run history, policy, and endpoint | Pause the source, preserve evidence, then repair or retire it |
| Sheet sync not configured | Six `GOOGLE_*` variables and workbook sharing | Correct protected configuration and retry idempotently |
| Review Queue is full | Bounded range and finalized rows | Archive reconciled rows before expanding the reviewed range |
| Sign-in email missing | Supabase Auth logs, rate limit, newest message | Retry after the rate window; password recovery remains available |
| Wrong public record | Official source and revision history | Correct or remove through `/admin/manage` |
| Migration-dependent release fails | Production schema and migration history | Stop rollout; do not patch tables manually without a migration |

## Officer transition

Before an officer leaves, verify GitHub, Vercel, Supabase, Google, recovery email,
and password-manager access with the incoming officer. Run one supervised login,
review decision, export, source-health check, and recovery drill. Remove departed
access only after continuity is confirmed.

The unresolved ownership and backup fields in [`../HANDOFF.md`](../HANDOFF.md)
are intentional visible blockers. They must be filled with locations, not secret
values.
