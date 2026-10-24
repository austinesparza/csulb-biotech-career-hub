import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createOpenAiCompatibleExtractionModel } from "../src/lib/pipeline/model-openai";
import { MAX_BUNDLE_BYTES, runShadowCycle, validateShadowBundle } from "../src/lib/pipeline/shadow-cycle";

async function main() {
  const { values } = parseArgs({ options: { bundle: { type: "string" }, out: { type: "string" },
    model: { type: "string" }, revision: { type: "string" }, "base-url": { type: "string", default: "http://127.0.0.1:11434/v1" } } });
  if (!values.bundle || !values.out || !values.model || !values.revision) {
    throw new Error("Usage: npm run shadow:run -- --bundle FILE --out DIRECTORY --model MODEL --revision DIGEST [--base-url LOOPBACK_URL]");
  }
  if ((await stat(values.bundle)).size > MAX_BUNDLE_BYTES) throw new Error("shadow bundle exceeds size limit");
  const bundle: unknown = JSON.parse(await readFile(values.bundle, "utf8"));
  validateShadowBundle(bundle);
  // No environment-loaded keys, remote override, database adapter, or tool execution.
  const model = createOpenAiCompatibleExtractionModel({ model: values.model, baseUrl: values["base-url"] });
  const report = await runShadowCycle(bundle, { model, modelRevision: values.revision, outputDir: path.resolve(values.out),
    onProgress: (record, completed) => console.error(`${completed}/${bundle.postings.length} ${record.sourcePostingVersionId}: ${record.status}`) });
  console.log(JSON.stringify({ report: path.resolve(values.out, "report.json"), review: path.resolve(values.out, "review.md"),
    completed: report.records.length, resumed: report.resumed, errors: report.records.filter(item => item.status === "error").length }));
  if (report.records.some(item => item.status === "error" || item.status === "quarantined") || report.labels.mismatches.length) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
