# Public duplicate audit, September 25, 2026

The public board had 28 approved `open_verified` records at the audit. Grouping
their application URLs after trimming a trailing slash found **zero repeated
public URLs**. Grouping by exact stored `family_key` also found zero repeated
public keys. These two checks do not prove the absence of semantic duplicates.

The two Ginkgo Autonomous Lab software cards are separate [graduate](https://job-boards.greenhouse.io/ginkgobioworks/jobs/5033171007) and [general](https://job-boards.greenhouse.io/ginkgobioworks/jobs/5033167007) Greenhouse requisitions. Their responsibilities are nearly identical, but their qualification language and pay ranges differ. The graduate page permits recent BS/MS graduates or current students in listed fields; the general page says no degree is necessary and requires coding skills. Both application forms were visible during this check. Removing or merging one would discard a distinct application route. The ingestion matcher had produced `possible_duplicate` tasks for both records; officer approvals closed the tasks, but the public card hid the eligibility difference in its details accordion. The board now shows the different requirements next to each similar card.

The officer duplicate scanner now scans active records instead of filling its
results with private historical archives. It shows entry requirements next to
candidate pairs and asks for an explicit comparison before an officer marks
records with different application links as duplicates.

The database also has 53 repeated normalized URLs across **private historical**
records, representing 104 rows beyond one per URL. Of the 157 rows in these
groups, 153 are `archive_only`, two are `not_relevant`, one is `hidden`, and one
is marked `duplicate`. None is public. Do not delete or merge archived evidence
as a side effect of this UI correction. Separately, an unlinked, rejected
Flagship duplicate arose during a failed source-link insertion; see
`docs/15-operational-pipeline.md`.

The new partial unique index stops a second public approval of the same posting URL after trimming a trailing slash. It leaves two distinct employer requisitions visible. A SQL contract test attempts a second approval and requires rejection without changing the candidate. This is an exact-URL guard, not a semantic-deduplication claim; officers still need to compare different posting IDs and eligibility gates before publishing similar roles.
