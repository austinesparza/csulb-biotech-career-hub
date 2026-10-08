import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { MAX_BUNDLE_BYTES, atomicJson, sealShadowBundle, validateShadowBundle } from "../src/lib/pipeline/shadow-cycle";
import type { ShadowPosting } from "../src/lib/pipeline/shadow-cycle";

async function main() {
  const { values } = parseArgs({ options: { bundle: { type: "string" }, labels: { type: "string" }, out: { type: "string" } } });
  if (!values.bundle || !values.labels || !values.out) throw new Error("Usage: npm run shadow:label -- --bundle FILE --labels FILE --out FILE");
  if ((await stat(values.bundle)).size > MAX_BUNDLE_BYTES || (await stat(values.labels)).size > MAX_BUNDLE_BYTES) throw new Error("input exceeds size limit");
  const bundle: unknown = JSON.parse(await readFile(values.bundle, "utf8"));
  validateShadowBundle(bundle);
  const labels: unknown = JSON.parse(await readFile(values.labels, "utf8"));
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) throw new Error("labels must map posting version IDs to field values");
  const mapping = labels as Record<string, ShadowPosting["expected"]>;
  const ids = new Set(bundle.postings.map(posting => posting.row.source_posting_version_id));
  if (Object.keys(mapping).some(id => !ids.has(id))) throw new Error("labels contain a posting version absent from the bundle");
  const labelled = sealShadowBundle({ ...bundle, postings: bundle.postings.map(posting => ({ ...posting,
    ...(Object.hasOwn(mapping, posting.row.source_posting_version_id) ? { expected: mapping[posting.row.source_posting_version_id] } : {}) })) });
  await atomicJson(path.resolve(values.out), labelled);
  console.log(JSON.stringify({ file: path.resolve(values.out), bundleId: labelled.id, labelledPostings: Object.keys(mapping).length }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
