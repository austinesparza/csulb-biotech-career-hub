import path from "node:path";
import { parseArgs } from "node:util";
import { createPipelineServiceClient, SupabaseExtractionStore } from "../src/lib/pipeline/store-supabase";
import { SCHEMA_VERSION, PROMPT_VERSION } from "../src/lib/pipeline/worker";
import { atomicJson, createShadowBundle } from "../src/lib/pipeline/shadow-cycle";

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" }, limit: { type: "string", default: "10" } } });
  if (!values.out) throw new Error("Usage: npm run shadow:export -- --out data/private/bundle.json [--limit 10]");
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer from 1 to 100");
  const store = new SupabaseExtractionStore(createPipelineServiceClient());
  const bundle = createShadowBundle(await store.next(SCHEMA_VERSION, PROMPT_VERSION, limit));
  await atomicJson(path.resolve(values.out), bundle);
  console.log(JSON.stringify({ file: path.resolve(values.out), postings: bundle.postings.length, bundleId: bundle.id }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
