# Employer requisition search and review handoff

## Scope and outcome

The September 24 screenshot catalog contained 49 private `user_submissions` records with `intake_stage = source_research`. The screenshot crop, an aggregator listing, and an indexed snippet are leads, not proof that the specific role is currently accepting applications. This playbook records the September 25 employer-site investigation and the route from an individual requisition to an officer's private review queue.

The [requisition catalog](./2026-09-25-employer-requisition-catalog.json) records all 49 screenshot leads, including unresolved items. We found 32 individual employer/ATS URLs; 17 still lack a safely identifiable role URL. Of the 32, two were exact matches to existing approved opportunities and were linked without another draft, three employer pages explicitly said the role was closed, 17 distinct candidates entered private opportunity review, and ten retain their links in source research because of degree, scope, cycle, or live-state questions. Four additional discovery leads (Nanopath, Vertex, Beckman Coulter, and Sanofi Gene Therapy) entered private opportunity review. The result is **21 unique, unpublished drafts with 21 open review tasks**, and no public-field mutation of existing approved roles. The employer-page checks were made September 25, 2026; this is a dated snapshot.

The October 3 *anticipated* employer closing date for J&J Global Regulatory Affairs R-098485 is the urgent officer check. Its private review task has priority 5 and the employer's date, rather than an inferred third-party deadline. [J&J employer posting](https://www.careers.jnj.com/en/jobs/r-098485/global-reg-affairs-intern/).

Source-research records are retained for the other 30 items: ten pending with a candidate employer URL, three with an employer-verified closed page, and 17 without a safely identifiable URL. Closed roles stay marked `closed` in their intake metadata and do not have an active opportunity draft. Two additional discovery links (Alcon and Aldevron) remain indexed-only candidates until the full employer page can be checked. The five MD Anderson role URLs remain distinct discovery leads; several require a recently completed degree and one excludes current degree seekers. Their presence in discovery must not imply eligibility for an enrolled master's student.

## Search each employer, then each role

1. Read the title, employer, location, season and any requisition number from the lead. Search exact distinctive title terms plus the employer's careers domain, without requiring `master's` or `2027` in every query. Search alternate titles and geography separately.
2. Visit the employer careers search and follow its result to a **single job detail page**. When the marketing careers page redirects, search the recruiting tenant (Workday, Greenhouse, iCIMS, Yello, Radancy, ADP, PrismHR or an institutional portal) by exact title or requisition ID. A generic careers landing page is not a role link. A search-engine hit with an official ATS hostname is still only a candidate until employer ownership and title match.
3. Record the canonical employer/ATS URL, employer identity, exact title, requisition ID, location, term, observed date, Apply state, deadline, degree and structural gates. Quote or point to the employer text for every asserted gate. If a portal will not render, record `indexed_only` and leave Apply/eligibility unknown. If a role page says filled, mark it closed even when search results still show an old snippet. Preserve both dead marketing links and live ATS alternatives in private notes.
4. Search `opportunities`, `discovery_leads`, `user_submissions`, and `source_postings` for the canonical URL and stable requisition ID. Ignore tracking parameters and trailing slashes. A shared employer pool is one requisition even if multiple screenshots or syndicators mention it; distinct location requisitions are separate only when the employer IDs differ. Compare title families to flag likely reposts, never merge two different requisition IDs automatically.
5. If an existing opportunity matches, link/resolve the intake item and keep the approved public record unchanged. If a role is distinct and evidence supports a meaningful officer decision, create **only a private** `opportunities.status = needs_review`, `review_status = pending`, `public_safe = false` record and an open `review_tasks` item. Attach the official URL and research findings to private notes, retain unknown values, and keep off-cycle or institution-specific restrictions visible. Officer approval and publication are separate actions.
6. For unresolved, expired, undergraduate-only, institution-locked or program-year mismatches, retain the individual link and the reason in source research or discovery archive. Do not relabel these as open graduate internships. Recheck indexed-only ATS URLs in an authenticated browser or through a permitted public API before claiming availability.

### Observed search routes worth keeping

| Route | Example and lesson |
| --- | --- |
| Marketing board → individual requisition | Sanofi Cambridge 2027 summer pool has one Radancy job ID, regardless of BioSpace syndication. |
| ATS fallback when marketing page dies | Sanofi spring Immunology Radancy URL returned 404 while a different official Workday requisition remained indexed. Keep availability unknown until Apply is confirmed. |
| Exact employer domain + role phrase | Cedars-Sinai's academic-credit internship and Arthrex's orthobiologics co-op surfaced as distinct employer detail pages. |
| Employer directory → sibling roles | IBRI's PrismHR directory exposed computational and bioinformatics siblings with *different* institution/degree rules. |
| Verify the live page | Thermo Fisher's vaccine intern remained indexed even as the employer page reported filled. |
| Requisition identity across locales/locations | Elanco Clinton and J&J regulatory roles have stable requisition IDs; changing locale or a tracking query does not create a second role. |

### Integration and future automation

Use the current intake and promotion controls rather than another publication path. Add search-plan templates per ATS tenant and employer; store search query, observed URL, requisition, redirected URL, fetched text, fetch result and timestamp as discovery observations. Resolve only when the title/employer/requisition agree. Before private draft creation run URL and requisition dedupe across public, hidden, archived and pending records. Send uncertain gates to a task with the original quote or `unknown`. Track `official_url_found`, `apply_verified`, `closed`, `existing_record`, `unique_draft` and `unresolved` as separate outcomes, with no inference that an indexed hit is open. Search terms should rotate by scientific lane and method, and cover both summer and off-cycle programs without requiring educational terms in every query. Recheck deadline-bearing unique roles first; recheck the employer's official Apply state before any public claim.

Never use a third-party login, bypass a rate limit, or infer an employer posting from a patterned URL. The officer makes the public decision.
