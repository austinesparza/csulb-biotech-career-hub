# Documentation index and authority

This index separates material that operates the current system from records that
explain how it was designed. A document's presence does not prove that a feature
is active.

## Authority order

When two sources disagree, use this order:

1. Executable migrations, current application code, and tests
2. Verified production behavior and deployment state
3. [`16-current-system-status.md`](16-current-system-status.md)
4. Current architecture and operating references
5. Product, design, and policy documents
6. Historical design and implementation records

Production counts and source-health observations must include an observation
date. They do not override durable architecture or policy.

## Start here

| Audience | Document | Purpose |
| --- | --- | --- |
| Everyone | [`../README.md`](../README.md) | Repository entry point and validation commands |
| Officers | [`../HANDOFF.md`](../HANDOFF.md) | Weekly, monthly, and transition runbook |
| Developers | [`current-architecture.md`](current-architecture.md) | Current system map and security boundaries |
| Operators | [`operations-reference.md`](operations-reference.md) | Workflow ownership, schedules, and recovery |
| Deployers | [`environment-reference.md`](environment-reference.md) | Environment variables and secret scope |
| Maintainers | [`documentation-maintenance.md`](documentation-maintenance.md) | Rules for keeping documentation current |

## Current governing documents

| Document | Authority |
| --- | --- |
| [`16-current-system-status.md`](16-current-system-status.md) | Dated production and repository audit |
| [`17-capability-roadmap.md`](17-capability-roadmap.md) | Forward-looking priorities and acceptance gates |
| [`pipeline-integration.md`](pipeline-integration.md) | Canonical ingestion, review, and publication contract |
| [`15-operational-pipeline.md`](15-operational-pipeline.md) | Detailed pipeline implementation and rollout |
| [`connector-contracts.md`](connector-contracts.md) | Requirements shared by source connectors |
| [`scheduled-sheet-ingestion.md`](scheduled-sheet-ingestion.md) | Scheduled discovery and Sheet handoff |
| [`weekly-review-notifications.md`](weekly-review-notifications.md) | Officer digest configuration and safety boundary |
| [`12-sheets-integration.md`](12-sheets-integration.md) | Sheet field ownership and reconciliation model |
| [`../SECURITY.md`](../SECURITY.md) | Threats, credential lifecycle, and incident response |
| [`../DESIGN.md`](../DESIGN.md) | Current design and accessibility contract |
| [`IMAGE-DIRECTION.md`](IMAGE-DIRECTION.md) | Scientific imagery and credit rules |

## Stable technical references

- [`03-architecture.md`](03-architecture.md): original architecture vocabulary;
  use `current-architecture.md` for current implementation.
- [`04-database-schema.md`](04-database-schema.md): conceptual schema; executable
  migrations remain authoritative.
- [`06-data-policy.md`](06-data-policy.md): public and private data rules.
- [`08-import-dedupe-scoring.md`](08-import-dedupe-scoring.md): CSV intake,
  matching, and legacy review-score behavior.
- [`09-review-workflow.md`](09-review-workflow.md): officer decision lifecycle.
- [`14-search-taxonomy.md`](14-search-taxonomy.md): search and classification
  vocabulary; `src/lib/pipeline/taxonomy/lanes.yaml` is executable authority.

## Historical records

Documents marked **Historical record** preserve decisions, audits, completed
phases, and rejected alternatives. They should not be updated to pretend they
were written for the current system. Add a correction note or update a current
reference instead.

This group includes the original product and MVP sequence (`01` through `11`),
the long-form ingestion audit and phase reports, `13-pipeline.md`, and
`operations-search-and-automation-plan.md`.

Common historical mismatches include graduate-only scope, disabled sources,
automatic deadline sweeps, offline installation, scheduler choice, test counts,
and reports that were planned but never implemented.

## Maintenance

Run `npm run docs:check` after changing documentation, routes, scripts,
environment configuration, or workflows. Update the documentation in the same
pull request as behavior changes. See
[`documentation-maintenance.md`](documentation-maintenance.md) for the review
checklist.
