# CSULB Biotech Career Hub

The CSULB Biotech Career Hub is a student-maintained, officer-reviewed directory
of biotechnology internships, research programs, and early-career opportunities.
It serves undergraduate and graduate students while preserving the source,
eligibility evidence, and review history behind every published record.

Production: <https://csulb-biotech-career-hub.vercel.app/>

## Start here

| Need | Read |
| --- | --- |
| Understand the product | [`PRODUCT.md`](PRODUCT.md) |
| Maintain the site as an officer | [`HANDOFF.md`](HANDOFF.md) |
| Understand the current architecture | [`docs/current-architecture.md`](docs/current-architecture.md) |
| Operate or troubleshoot a workflow | [`docs/operations-reference.md`](docs/operations-reference.md) |
| Configure an environment | [`docs/environment-reference.md`](docs/environment-reference.md) |
| Check the latest audited state | [`docs/16-current-system-status.md`](docs/16-current-system-status.md) |
| Find any other document | [`docs/README.md`](docs/README.md) |

Code, executable migrations, tests, and verified production behavior take
precedence over prose. Production counts in the status document are dated
observations, not constants.

## Local development

Requirements: Node.js 22 and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The public UI needs the two `NEXT_PUBLIC_SUPABASE_*` values. Officer actions,
imports, and workers also require a server-only Supabase key. Optional services
remain disabled unless their documented feature flag and credentials are set.
See [`docs/environment-reference.md`](docs/environment-reference.md).

## Validation

Run the same checks used by CI before opening a pull request:

```bash
npm run docs:check
npm run typecheck
npm run lint
npm test
npm run test:pipeline
npm run test:digest
npm run test:publish-data
npm run test:schema
npm run build
```

The **Database contracts** workflow applies every migration to a disposable
database. Do not manually infer migration order from filenames or rerun a
migration against production. Add a new migration, test the complete chain, and
roll it out explicitly.

## System boundaries

1. Public pages read restricted `public_*` views, not private base tables.
2. Automated retrieval, discovery, model output, Sheet decisions, and public
   submissions remain private until an authenticated officer approves them.
3. Approved public records are not silently overwritten by later imports.
4. Private notes, contact information, raw source text, and unreviewed model
   output never belong on a public surface.
5. Sources must have documented policy and robots review before recurring use.
6. Preview deployments must not receive privileged production credentials.

The complete invariants and data flow are documented in
[`docs/current-architecture.md`](docs/current-architecture.md).

## Deployment

Pull requests receive code review and CI. Merging `main` triggers the production
Vercel deployment. Database migrations are a separate, explicit rollout step.
The day-of deployment and ownership checklist is in [`LAUNCH.md`](LAUNCH.md),
and the durable deployment contract is in
[`docs/07-deployment.md`](docs/07-deployment.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/app` | Public pages, officer interface, and route handlers |
| `src/lib` | Product rules, database clients, ingestion, and pipeline services |
| `src/__tests__` | Unit and contract regression tests |
| `scripts` | Maintainer, worker, publishing, and diagnostic commands |
| `supabase/migrations` | Executable database history |
| `.github/workflows` | CI, recovery, notification, security, and data workflows |
| `public/brand` | Local scientific imagery and employer marks |
| `docs` | Current references and historical design records |

## Ownership and continuity

The application is maintained by the CSULB Biotechnology Club, not by CSULB as
an institution. Repository, Vercel, Supabase, Google, and recovery access should
be held by at least two active officers and one advisor. Known ownership gaps are
kept visible in [`HANDOFF.md`](HANDOFF.md) rather than hidden in private memory.

## Security

Do not commit credentials, production records, private officer notes, or
submitter information. Report vulnerabilities using the process in
[`SECURITY.md`](SECURITY.md).
