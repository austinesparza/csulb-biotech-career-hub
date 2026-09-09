# Search logic

Three axes that the old scorer collapsed into one number.

| Axis | Question | Where |
|---|---|---|
| Lane | what science | `taxonomy/lanes.yaml: lanes` |
| Function | what you'd do | `functions` |
| Method | what you'd learn | `methods` |
| Type | is it in scope | `opportunity_types` |
| Stage | can a master's student apply | `graduate_stage` |
| Gate | structural vs personal | `structural_gates` / `personal_gates` |

**Relevance rule:** `(lane OR method) AND (function OR internship-type) AND NOT excluded-title`.
Stage and gates classify; they never silently filter.

## The two rules that do the most work

**1. Context gating.** `data_science` has `requires_context: true`, so it only counts
when a biological context term co-occurs. Without this, "Data Science Intern" at a
bank matches — the exact failure of an undergrad-era scorer. Verified: dropped.

**2. Weak terms never qualify alone.** `cancer` lists `growth, proliferation, survival`
as weak. They add weight when a core term is present and are worthless alone, so
"track growth and survival of key accounts" at a logistics company doesn't match.

## Term matching

Word-boundary aware and separator-tolerant, so `ALS` doesn't match `also`,
`immuno-oncology` matches the `oncology` core term, and `r/bioconductor` matches
despite the slash. All 32 classifier tests pass.

## Student-facing search

The same taxonomy powers the site's filters. Because `methods` are extracted per
posting, a student can search "Seurat" or "flow cytometry" and get roles that never
say those words in the title — which is the search students actually want and no
job board offers.

## Query strings for search-capable connectors

Short, 2–4 words. Long boolean strings behave inconsistently across providers and
often return nothing silently. `buildQueries()` emits per-lane sets, e.g.
`single-cell intern`, `spatial transcriptomic internship`, `scrna-seq intern`.

## Maintaining it

The taxonomy is data, not code. An officer adds a term to a YAML list, bumps
`version`, opens a PR. CI runs the classifier tests against the golden set. Bumping
`version` marks existing candidates for reclassification — the deterministic stage
is free to re-run, so a taxonomy improvement retroactively improves every record.
