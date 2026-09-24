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

Officer screens: `/admin/review?tab=leads` for discovery leads, `/admin/review?tab=submissions` for screenshot research, and `/admin/review?tab=tasks` for due work. PR #114 merged the separate source-research UI and the missing-link explanation on September 24.

## Remaining work

The 49 screenshots without a role URL require targeted employer/ATS resolution. An officer should confirm current Apply, degree and enrollment gates, authorization, timing and employer identity before promoting any lead. Closed and undergrad-only records should receive explicit officer dispositions. The discovery service is still disabled; this intake is a one-time bridge, not recurring coverage.

## Structured handoff after initial intake

The 49 screenshot-only submissions now have structured `intake_stage = source_research`, `posting_status = unknown`, `msc_eligibility = unknown`, a research group, a numeric research priority and a specific next check. They remain private. Five lead the source-finding queue, ten are flagged for off-cycle checks, six for identity or special gates, nine for low signal or past-cycle review, and 19 for adjacent or unknown scope. A group is an officer research aid, not a confirmed eligibility decision.

Two distinct Summer 2027 J&J requisitions were checked against employer pages showing an Apply link on September 24, then initially moved to `needs_review` with `public_safe = false`: [Oncology Discovery Scientist R-099898](https://www.careers.jnj.com/en/jobs/r-099898/oncology-discovery-scientist-intern/) and [Oncology Clinical Scientist R-099892](https://www.careers.jnj.com/en/jobs/r-099892/oncology-clinical-scientist-intern/). Both accept graduate master's students in the posted text, require continued enrollment and permanent U.S. work authorization, and list November 3 as an **anticipated** close. Workday form status and individual eligibility remain unknown. R-099892 has a title/body mismatch for the officer to resolve. Their discovery lead tasks were closed as handed off; the other 16 new discovery lead tasks remained open at this check.

At 22:41 UTC on September 24, an officer approved R-099898 with a recorded `open` source check, publishing it as `open_verified`. Its employer page still displayed an Apply link at our follow-up check. R-099892 remained private in `needs_review` with `source_check_result = unknown`. This was an officer decision, not automated publication; source status can change after the recorded check.

PR #114 separates the 49 source-research rows from ordinary student submissions, sorts them by research priority, and asks an officer to attest to an individual employer/ATS posting before creating another private draft. It also removed bulk lead promotion. A recorded employer URL is not proof of an open, graduate-accessible posting.

Five source-research tasks were added for catalog #42 HonorHealth, #50 MTF Biologics, #64 Genentech automation, and #65–66 Keros co-ops. Their October 1 dates are internal research targets, not employer deadlines. [MTF requisition 2026-8022](https://careers-mtfbiologics.icims.com/jobs/8022/co-op-research-and-development/job) was found on the employer ATS with an Apply option and a **January–June 2027** term; master's access remains unknown. [HonorHealth JR11460](https://honorhealth.wd12.myworkdayjobs.com/en-US/HonorHealth_careers/job/Intern---Research-in-Translational-Science_JR11460) was indexed on the employer Workday domain but did not render for a live Apply or gate check. Both URLs are stored as **candidate employer links** in source research, not confirmed posting URLs or Summer 2027 drafts.

## Source freshness and officer handoff

The initial September 24 live check found 27 public `open_verified` records, 15 of which had not been checked in more than seven days. Migration `seven_day_public_source_checks` was applied to production, and the health task function queued **15 private stale-record tasks** plus one source-health task. Rerunning the function added zero duplicates. After the separate officer decision above, the count became 28 public `open_verified` records. Age is a request to recheck, not proof of closure; no public status was changed automatically.

The officer route `/admin/manage` now supports an audited confirmation when the posting is still open and its fields have not changed. The officer must open the individual employer or ATS posting, confirm that Apply and the published details remain valid, give a reason, and confirm public safety. The action updates `last_checked_at` and closes the matching stale task. If the role closed or the source cannot be confirmed, use **Remove from website** or make an evidenced correction. A LinkedIn-only link does not qualify as an employer posting for the no-change confirmation. The 49 screenshot records remain source research. Of the two J&J drafts, R-099898 was subsequently approved by an officer and R-099892 still requires a source check.

The Sheet batch path now requires a recorded `open` check within seven days and an employer/ATS posting URL before publishing as `open_verified`. A Sheet approval by itself does not establish an opening. Search discovery remains disabled in production; this cleanup has not restored broad employer coverage.
