# Connector contracts

Last reviewed: 2026-09-10

These checks validate request and response shapes. They do not prove that a
particular employer identifier exists or that a production credential works.
Each new source still needs a preview fetch before activation.

| Source | Contract checked | Runtime status | Remaining onboarding check |
|---|---|---|---|
| Greenhouse | Public GET `/v1/boards/{board_token}/jobs?content=true`; `jobs[].id`, `absolute_url`, `location`, `departments`, `offices`, and optional content | Parser fixture and contract tests pass | Fetch the employer's actual board token |
| Lever | Public GET `/v0/postings/{site}?mode=json`; stable `id`, URLs, categories, locations, workplace type, and optional salary data | Official contract checked; public demo endpoint returned JSON | Fetch the employer's actual site name |
| Ashby | Public GET `/posting-api/job-board/{name}?includeCompensation=true`; public schema has no job `id`, so `jobUrl` is the connector identity | Parser corrected to the documented schema; unlisted and malformed records are skipped | Fetch one real board response and retain a redacted fixture |
| USAJOBS | GET `/api/Search`; requires registration email as `User-Agent` and an `Authorization-Key` header | Parser fixture passes; source-specific credential boundary implemented | Obtain a key, test against a preview source, and confirm rate-limit handling |

Primary references:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html)
- [Lever Postings API](https://github.com/lever/postings-api)
- [Ashby public job posting API](https://developers.ashbyhq.com/docs/public-job-posting-api)
- [USAJOBS Search API](https://developer.usajobs.gov/api-reference/get-api-search)
- [USAJOBS authentication](https://developer.usajobs.gov/guides/authentication)

## Security boundary

`safeFetch` remains credential-free. `createUsaJobsFetcher` is the only current
credentialed adapter. It rejects any protocol, host, or path outside the
documented USAJOBS Search endpoint, and it refuses to forward the key across a
cross-host redirect. Do not add arbitrary caller-controlled headers to
`safeFetch`; create another source-specific adapter with the same restrictions
if a future official API requires authentication.
