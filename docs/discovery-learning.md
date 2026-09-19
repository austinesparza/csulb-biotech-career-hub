# Discovery learning loop

The discovery learning loop measures which private leads officers find useful and
which search families recover them. It is a ranking and evaluation system. It is
not a publication system.

This loop does not learn scientific lanes, job functions, or methods. Those use
the separate [classification learning loop](classification-learning.md), because
multi-label tag correction has different labels, metrics, and safety rules.

## Objective

Two separate outcomes are measured:

1. **Selection quality:** whether an officer considers a discovered role relevant
   enough to continue reviewing.
2. **Discovery yield:** which employer, historical-watch, scientific-lane, and
   route families produce relevant leads.

Recall remains the primary discovery metric. A high relevance score cannot excuse
missing roles that officers observed elsewhere.

## Labels

Every lead outcome is explicit and append-only.

| Label | Model use | Meaning |
| --- | --- | --- |
| `relevant` | Positive | Continue review or promote the lead |
| `irrelevant` | Negative | Role does not belong in the Career Hub |
| `duplicate` | Excluded | Useful role already represented elsewhere |
| `closed` | Excluded | Potentially useful role found too late |
| `unverifiable` | Excluded | Relevance cannot be established from acceptable evidence |

Generic archiving is not a negative label. A duplicate or expired role can still
show that a search family found the right kind of opportunity.

Promotions record a positive label automatically. Officers can also add a role
the automated run missed from the Discovery Leads page. A missed-role entry saves
the URL, employer, title, and an officer-written relevance reason. It does not
fetch LinkedIn, copy the job description, or bypass normal review.

## Shadow model

`npm run discovery:train` fits an L2-regularized logistic regression using only
the latest `relevant` or `irrelevant` label for each lead. The feature set is
versioned and deliberately small:

- deterministic snippet-triage score, keep decision, and student bucket
- whether discovery came through an official feed or employer page
- discovery route and search-plan family
- search-result rank and repeat observations
- whether employer identity and a snippet were available

Names, demographics, school identity, personal eligibility, and officer free text
are not features. The model estimates officer relevance, not applicant quality.
The feature vector and query family are frozen when the officer records the
label, preventing later source resolution or repeat observations from leaking
post-decision information into training.

Predictions remain in shadow mode and are displayed only as advisory estimates.
They do not filter leads, change search allocation, approve records, or publish.

## Validation gates

Training does not begin until there are at least 30 binary labels with at least
10 examples from each class. Evaluation uses the newest 20 percent of labels as
a time-ordered holdout.

A model is only marked `eligible` for a future influence experiment when all of
the following hold:

- at least 60 binary labels and 20 examples from each class
- at least three positive and three negative holdout examples
- holdout ROC AUC of at least 0.65
- holdout log loss beats the prevalence-only baseline
- holdout Brier score beats the prevalence-only baseline

`eligible` does not mean active. Allowing a model to change review ordering or
search allocation requires a separate reviewed code change and a rollback plan.

## Learning where to search

The training report groups leads found by automated discovery by search-plan
family and reports a Beta(1,1)-smoothed relevant-lead rate. It also reports an
upper-confidence exploration score so a strong early result cannot permanently
starve new or low-volume query families.

Officer-supplied missed roles remain positive relevance labels, but they are not
credited to an automated query. They appear in a separate recall-gap report by
source route, employer, and scientific lane. Repeated gaps are evidence for new
employer watches or search-plan coverage, not proof that an employer should be
ranked ahead of others.

Use this report to propose search-plan changes. Do not automatically drop a query
family from a small sample.

## LinkedIn boundary

The system does not log in to LinkedIn, reuse member sessions, crawl LinkedIn, or
copy job descriptions. Officers may retain a role URL as a private lead and then
resolve an employer or ATS source. This follows the project's stricter operating
boundary and LinkedIn's prohibition on scraping or automated access in its
[User Agreement](https://www.linkedin.com/legal/user-agreement), checked
September 19, 2026.

## Operating sequence

1. Review discovery leads normally.
2. Use **Relevant, continue review** for a useful lead.
3. Use a specific close outcome and evidence-based reason for a non-promoted lead.
4. Add roles found outside the automated run through **Add a role discovery missed**.
5. After at least 20 new binary labels, run `npm run discovery:train` in a private
   worker environment with server-side Supabase credentials.
6. Review sample counts, time-holdout metrics, query-family yield, and drift before
   considering any behavior change.

Model versions, metrics, predictions, and feedback are private officer data with
RLS enabled. Publication still requires the existing authenticated officer
decision and public-view gates.
