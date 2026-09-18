# Documentation maintenance

Documentation is part of the release contract. Update it in the same pull request
as the behavior it describes.

## What belongs where

| Information | Location |
| --- | --- |
| Repository entry and validation | `README.md` |
| Product purpose and boundaries | `PRODUCT.md` |
| Visual and accessibility rules | `DESIGN.md` |
| Officer routine and continuity | `HANDOFF.md` |
| Security and incident response | `SECURITY.md` |
| Durable system structure | `docs/current-architecture.md` |
| Dated production observations | `docs/16-current-system-status.md` |
| Environment variable meaning | `docs/environment-reference.md` |
| Workflow and recovery detail | `docs/operations-reference.md` |
| Future work and acceptance gates | `docs/17-capability-roadmap.md` |
| Past decisions and completed phases | Historical records with a banner |

## Writing rules

1. Distinguish **implemented**, **enabled**, **production-verified**,
   **experimental**, and **planned**.
2. Date production counts, source health, and external observations.
3. Do not embed a test count unless the count is itself historically relevant.
4. Link to executable authority instead of copying large schemas or configuration.
5. Document secret names and scope, never values.
6. State who owns a recurring task and how failure is detected.
7. Preserve historical records; label them instead of rewriting their conclusions.
8. Use relative repository links so local and GitHub rendering agree.

## Pull-request checklist

- [ ] New or changed route is reflected in the architecture map.
- [ ] New environment variable is added to `.env.example` and the environment reference.
- [ ] New workflow or schedule is added to the operations reference.
- [ ] New migration changes the conceptual schema documentation when appropriate.
- [ ] Officer-facing behavior is reflected in `HANDOFF.md`.
- [ ] Public-facing behavior remains consistent with `PRODUCT.md` and `DESIGN.md`.
- [ ] Status claims distinguish code presence from production activation.
- [ ] `npm run docs:check` passes.

## Status refresh

Update `16-current-system-status.md` only after a deliberate audit. Record the
code commit and observation date separately. Do not replace durable documentation
with a transient count or infer production activation from code alone.

## Historical records

A historical banner should say:

> **Historical record.** This document preserves an earlier design, audit, or
> implementation phase. It is not the current operating authority. Start with
> `docs/README.md` and `docs/16-current-system-status.md`.

Leave the body intact unless correcting a factual transcription error. Current
guidance belongs in a current governing document.

