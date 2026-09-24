# September 24 screenshot intake ledger

This ledger accompanies the [73-row catalog](./2026-09-24-linkedin-screenshot-audit.md). It records what entered the project's **private** workflow on September 24, 2026. It does not certify that any role is currently open or eligible for a graduate student.

| Intake group | Catalog IDs | Destination | Result |
| --- | --- | --- | --- |
| Role-specific employer URLs not previously matched | 11, 18, 20, 24, 26, 30, 34, 36, 37, 39, 43, 48, 57, 60, 61, 63, 67, 73 | `archive_discovery_lead` RPC | 18 new private `discovery_leads`, 18 immutable observations, 18 open `review_tasks` |
| Screenshot-only listings or generic program links | 01–10, 13–14, 16, 19, 21–23, 27–29, 31–33, 35, 38, 40–42, 44–47, 49–55, 58–59, 62, 64–66, 68–69, 71–72 | `user_submissions` | 49 `new` opportunity research submissions; each has `payload.url = ''` and the exact missing-role-link caveat in `payload.details` |
| Already in discovery/archive | 12, 15, 17, 25, 56, 70 | `discovery_lead_observations` | Six additional screenshot observations linked to their existing lead IDs; no duplicate lead or new review decision |

All records include `batchId`/`batch_id = linkedin-screenshots-2026-09-24` and the original catalog ID. The records refer back to the image index in the catalog. Submissions with generic careers/program pages retain that link in the details field, **not** in the role-specific URL field. An officer must find the individual posting before creating a draft.

The direct employer URLs are source leads, not verified-open postings. Workday items with an indexed but unrendered page remain `unresolved`. Employer-hosted entries that are known closed, undergraduate-only, off-cycle, or special still carry those findings in the observation and must not be bulk promoted simply because the host is official. The prior Fred Hutch and Roche entries remain approved undergraduate records; this intake did not change their eligibility.

J&J PALM and AI has an officer task due September 25 with priority 10, reflecting the employer's **anticipated** close, not a guaranteed application window. The J&J Oncology Scientist tasks note the anticipated November 3 close, and IBRI's task notes its October 15 priority date and Indiana affiliation gate.

## Verification

The post-intake read-only database query returned **73 distinct catalog IDs**, partitioned into **18 newly archived leads**, **six matched existing leads**, and **49 screenshot-only submissions**. All 18 new lead tasks were open; all 49 submissions were in `new` status. None of the submissions had a linked opportunity. The archive RPC only creates private leads and tasks; promotion and public approval were not invoked.

Officer screens: `/admin/review?tab=leads` for the 18 new leads, `/admin/review?tab=submissions` for the 49 entries needing a direct URL, and `/admin/review?tab=tasks` for lead tasks and due dates. The draft PR also changes the submission UI to display a missing-link explanation instead of a broken empty anchor. That UI change is not in production until the PR is merged and deployed.

## Remaining work

The 49 screenshots without a role URL require targeted employer/ATS resolution. An officer should confirm current Apply, degree and enrollment gates, authorization, timing and employer identity before promoting any lead. Closed and undergrad-only records should receive explicit officer dispositions. The discovery service is still disabled; this intake is a one-time bridge, not recurring coverage.
