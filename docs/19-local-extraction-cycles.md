# Manual local-model extraction cycles

This first automation milestone produces private evidence reports from immutable posting versions. It supports manual launch and interruption recovery. Officers retain factual review and publishing authority. No shadow result is imported or published.

## Two environments

The trusted broker exports pending public posting evidence using the existing read-only `pending_pipeline_extractions` RPC. Only the broker has Supabase credentials. Exported rows omit opportunity links, relevance scores and unrecognized properties. Email addresses and phone numbers in posting text are redacted. Original-text and redacted-payload hashes are recorded separately; quotes bind to the redacted payload.

The laptop runner needs Node 22+, this checkout with `npm ci`, and a locally installed model exposing OpenAI-compatible structured chat completions. It reads a bundle, calls a loopback model endpoint, and writes local checkpoints and review files. It does not load database credentials, fetch employer pages, invoke tools, or publish. It refuses remote model URLs and HTTP redirects. This application boundary does not sandbox the model server itself. Run the model under the existing isolated account with networking blocked except the local API, and transfer only bundles and reports between accounts.

## Run a cycle

On the trusted broker, with existing worker credentials supplied in its environment:

```bash
npm run shadow:export -- --out data/private/bundle.json --limit 10
```

Copy the bundle to the laptop model account. Do not copy environment files or database keys. Start the local model server using your existing installation. Obtain the actual model digest or immutable revision from that installation, then run:

```bash
npm run shadow:run -- \
  --bundle data/private/bundle.json \
  --out data/private/local-cycle \
  --model YOUR_INSTALLED_MODEL \
  --revision YOUR_MODEL_DIGEST
```

The default endpoint is `http://127.0.0.1:11434/v1`. For the existing local OmniRoute endpoint, add `--base-url http://127.0.0.1:20128/v1`. Use a concrete model digest rather than a mutable tag as the revision. Re-run the same command after interruption. Completed review and quarantine records are reused only when posting data, model name/revision, extraction contract and taxonomy match. Errors retry on the next manual run. A corrupt checkpoint produces an explicit error; remove the affected checkpoint to re-extract it.

Output:

| File | Purpose |
| --- | --- |
| `report.json` | Model and source provenance, guard outcomes, timings, token metadata and optional officer-label comparisons |
| `review.md` | Officer packet with source links, values, supporting quotes, unknown fields, flags and errors |
| `checkpoints/*.json` | Atomic per-posting recovery records with content checksums |

Inspect `review.md` after every cycle. The runner continues through individual errors and returns exit code 1 for any error, quarantine or label mismatch. Neither `review` status nor exit code 0 is approval to publish. Bundles contain at most 100 postings, with 200 KB text per posting and a 25 MB file cap. Oversized evidence is rejected rather than truncated.

## Guards and evaluation

Every field must match the structured extraction schema, including the integrity echo. Unknown values require a null quote. Asserted values need a sufficiently long quote present in the normalized payload. The runner quarantines failed echo/binding checks, injection canaries, preferred qualifications asserted as requirements, and compensation units absent from the supporting quote. These are targeted contradiction checks, not a general proof that a quote supports its value. Review remains necessary for numbers, eligibility, dates, missing facts and other interpretation.

The `extract-v2` prompt preserves compensation units and uses the stricter guards. The version bump causes the live extraction worker to consider existing posting versions for re-extraction when that worker is explicitly enabled. The shadow exporter makes no writes and does not consume that inbox.

For a real accuracy benchmark, collect a fixed sample of approved postings and held-out sources, and label each chosen field independently before examining model output. Create a JSON label file mapping posting version IDs to expected field values:

```json
{
  "POSTING_VERSION_ID": {
    "gpa_requirement": "3.0 preferred",
    "location": "Unknown"
  }
}
```

Attach these labels and regenerate the bundle manifest:

```bash
npm run shadow:label -- \
  --bundle data/private/bundle.json \
  --labels data/private/officer-labels.json \
  --out data/private/benchmark.json
```

Run `shadow:run` with `--bundle data/private/benchmark.json`. Missing labels are unscored; explicitly labelled `Unknown` measures whether the model abstains. Label comparisons trim whitespace and ignore case but otherwise require an exact value, so equivalent wording needs officer review. Model errors count as mismatches. `report.json` preserves the compared denominator and every mismatch. Without labels, the report explicitly states that it is not an accuracy benchmark.

`npm run test:pipeline` includes synthetic guard and HTTP transport regressions. These verify resumability, version invalidation, corrupt checkpoints, injection quarantine, schema rejection, contradiction guards and the actual loopback CLI. They do not measure the laptop model's quality.

## Next milestones

1. Run the labelled benchmark on the laptop model, examine all mismatches, and set promotion criteria using real error rates and officer corrections.
2. Add a trusted result-import broker that revalidates source provenance and guard results and creates only private review records. Never accept a model's supplied approval flag.
3. Add a bounded research controller around existing discovery and verification tools, with explicit source policies, per-host limits, durable task states and a run budget. Use the local model for extraction and classification proposals; route difficult conflicts to stronger reasoning and officer review.
4. Expand governed sources and add stale-role maintenance after the benchmark and import path are reliable.

Keep manual cycle launch until the reports are consistently useful. Scheduling is a later operational choice and is not required for these capabilities.

## Lint dependency compatibility

The security gate found GHSA-vfj7-8cjw-p6xm in the existing Next lint plugin's `fast-glob` dependency chain. All published `braces` releases were affected when checked on October 8, 2026. A scoped npm override substitutes pinned `tinyglobby@0.2.17` for that plugin's `fast-glob` dependency, removing `micromatch` and `braces` from the install. Next's lint helper uses only `globSync` with `onlyDirectories`; compatibility tests exercise the installed helper with default roots, brace globs and multiple roots, plus the reported deep-brace input. The framework and lint rule versions remain unchanged. Reassess this override when the upstream plugin drops or fixes the affected chain. The ordinary security audit remains enabled.
