# Classification learning loop

Role relevance and role classification are separate decisions. Relevance asks
whether a role belongs in the Career Hub. Classification assigns zero or more
labels on independent axes:

| Axis | Question | Examples |
| --- | --- | --- |
| Scientific lane | What science is this about? | Genomics and genetics; immunology and infectious disease |
| Job function | What would the student do? | Research and discovery; computational and analysis |
| Method | Which named techniques or tools appear? | PCR; Python; flow cytometry |

Audience, degree stage, and eligibility remain evidence-based review decisions.
They are stored beside the tag snapshot for audit context but are explicitly
excluded from tag learning.

## Review and feedback contract

The deterministic taxonomy proposes initial tags. The opportunity review screen
lets an officer add or remove controlled tags and also allows an axis to remain
empty when the source is ambiguous. Approving or archiving the record atomically
saves one append-only snapshot containing:

- the exact extraction and taxonomy version that made the proposal;
- proposed scientific lanes, job functions, and methods;
- officer-final tags;
- the decision, officer, and timestamp; and
- the raw deterministic classifier details used to explain the proposal.

Records created before versioned extraction are retained as `legacy_draft`
snapshots. They are useful audit history but are not scored as machine proposals.
Rejected-as-irrelevant records are not tag examples because a final
classification was never established.

The table is private, protected by RLS, and append-only. Public tags still come
only from the final officer decision. No learned output can approve, publish, or
rewrite the taxonomy.

## Evaluation

Run the private report with server-side Supabase credentials:

```bash
npm run classification:report
```

The report treats each axis as a multi-label task and returns:

- exact set match and proposal coverage per axis;
- per-label true positives, false positives, and false negatives;
- per-label precision, recall, F1, and final support;
- micro precision, recall, and F1 across all labels; and
- macro F1 only for labels with enough final examples.

A single accuracy number is intentionally absent. Empty and rare labels would
make it look strong while hiding missed tags. Metrics are also tied to taxonomy
versions so a definition change is not silently mixed with an older classifier.

## Data gates and next step

The report does not consider shadow suggestions ready until it has at least 30
extraction-backed reviews and at least eight officer-final examples for a label.
Those are minimum evaluation gates, not proof of production quality. Rare labels
continue using the deterministic taxonomy and officer review.

Once the gate is met, a future change may compare a shadow multi-label suggester
against the deterministic baseline using a time-ordered holdout. It must support
abstention, show evidence, and remain advisory. Activating learned tags or
automatically editing `lanes.yaml` requires a separate reviewed change with a
rollback plan.

## Taxonomy maintenance

Repeated false negatives suggest missing vocabulary or a missing label. Repeated
false positives suggest an overly broad term or weak context gate. Officers
should inspect examples before changing the versioned YAML. A correction count
alone does not prove which term caused the error, and the system never edits the
taxonomy automatically.
