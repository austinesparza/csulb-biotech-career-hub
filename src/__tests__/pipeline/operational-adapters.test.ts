import { createOpenAiCompatibleExtractionModel } from "../../lib/pipeline/model-openai";
import { createScrapeGraphClient, createScraplingClient } from "../../lib/pipeline/scraping-clients";
import { runExtractionBatch } from "../../lib/pipeline/extraction-runner";
import { EXTRACTION_FIELDS } from "../../lib/pipeline/extraction-schema";
import type { ExtractionModel } from "../../lib/pipeline/worker";
import type { ExtractionInboxRow, SupabaseExtractionStore } from "../../lib/pipeline/store-supabase";

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = "") => {
  condition ? pass++ : fail++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  -> ${detail}`}`);
};

console.log("=== Scrapling process boundary ===\n");
{
  const invocation: { current: { file: string; args: string[]; options: unknown } | null } = { current: null };
  const client = createScraplingClient({
    cwd: "/repo",
    execFile: async (file, args, options) => {
      invocation.current = { file, args, options };
      return { stdout: "Rendered public internship posting with enough text to archive and classify." };
    },
  });
  const body = await client("https://8.8.8.8/jobs/123");
  ok("returns renderer output", body.startsWith("Rendered public"));
  ok("passes URL as one fixed argv value", invocation.current !== null && invocation.current.args.length === 2 && invocation.current.args[1] === "https://8.8.8.8/jobs/123");
  ok("does not expose shell, cookie, proxy, or stealth flags", invocation.current !== null && !JSON.stringify(invocation.current).match(/shell|cookie|proxy|stealth/i));
}

console.log("\n=== ScrapeGraph fetch-only boundary ===\n");
{
  let sent = "";
  const client = createScrapeGraphClient({
    apiKey: "test-key",
    fetch: async (_url, init) => {
      sent = String(init?.body);
      return new Response(JSON.stringify({ results: { markdown: { data: ["Public posting markdown with graduate internship details."] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const text = await client("https://8.8.8.8/careers");
  const request = JSON.parse(sent) as Record<string, unknown>;
  ok("returns archived markdown", /graduate internship/.test(text));
  ok("requests markdown, not remote extraction", JSON.stringify(request.formats) === JSON.stringify([{ type: "markdown" }]));
  ok("explicitly disables stealth", JSON.stringify(request.fetchConfig) === JSON.stringify({ mode: "js", stealth: false }));
  ok("sends no cookies, proxy, or extraction prompt", !sent.match(/cookie|proxy|prompt|schema/i), sent);
}

console.log("\n=== OpenAI-compatible local model boundary ===\n");
{
  let remoteBlocked = false;
  try { createOpenAiCompatibleExtractionModel({ model: "x", baseUrl: "https://model.example/v1" }); }
  catch { remoteBlocked = true; }
  ok("remote gateway is opt-in", remoteBlocked);

  let requested = "";
  let requestHeaders = "";
  const model = createOpenAiCompatibleExtractionModel({
    model: "fixture-model",
    fetch: async (url, init) => {
      requested = `${url} ${String(init?.body)}`;
      requestHeaders = JSON.stringify(init?.headers);
      return new Response(JSON.stringify({
        id: "trace-1",
        choices: [{ message: { content: JSON.stringify({ deadline: { value: "Unknown", quote: null } }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200 });
    },
  });
  const result = await model.extract({
    system: "system",
    user: "posting",
    schema: {
      name: "x",
      strict: true,
      schema: { type: "object", additionalProperties: false, required: [], properties: {} },
    },
  });
  ok("defaults to loopback OmniRoute", requested.startsWith("http://127.0.0.1:20128/v1/chat/completions"), requested.slice(0, 80));
  ok("uses constrained JSON schema", requested.includes('"type":"json_schema"'));
  ok("turns prompt compression off for evidence binding", requestHeaders.includes("X-OmniRoute-Compression") && requestHeaders.includes("off"));
  ok("records token and trace metadata", result.inputTokens === 10 && result.outputTokens === 5 && result.traceId === "trace-1");

  let omissionRejected = false;
  try {
    await model.extract({
      system: "system",
      user: "posting",
      schema: {
        name: "x",
        strict: true,
        schema: { type: "object", additionalProperties: false, required: ["missing"], properties: {} },
      },
    });
  } catch { omissionRejected = true; }
  ok("rejects a model that omits a required field", omissionRejected);
}

console.log("\n=== Extraction writes only private evidence-bound records ===\n");
{
  const rawText = "Graduate students may apply for this cancer genomics internship.";
  const inbox: ExtractionInboxRow = {
    source_posting_version_id: "version-1",
    source_posting_id: "posting-1",
    opportunity_id: "opportunity-1",
    employer: "Example Biotech",
    title: "Cancer Genomics Intern",
    canonical_url: "https://example.org/jobs/1",
    relevance_score: 90,
    raw_text: rawText,
    created_at: "2026-09-10T00:00:00Z",
  };
  const saved: unknown[] = [];
  const store = {
    async next() { return [inbox]; },
    async save(input: unknown) { saved.push(input); return "extraction-1"; },
  } as unknown as SupabaseExtractionStore;
  const model: ExtractionModel = {
    name: "fixture",
    async extract({ user }) {
      const fields: Record<string, { value: string; quote: string | null }> = {};
      for (const key of Object.keys(EXTRACTION_FIELDS)) fields[key] = { value: "Unknown", quote: null };
      fields.masters_eligibility = { value: "Graduate students accepted", quote: "Graduate students may apply" };
      fields.integrity_echo = { value: user.split("\n\n")[0], quote: null };
      return { fields };
    },
  };
  const report = await runExtractionBatch({ store, model });
  const savedRow = saved[0] as Record<string, unknown>;
  ok("writes one private extraction", report.saved === 1 && saved.length === 1, JSON.stringify(report));
  ok("evidence is bound before save", savedRow.evidenceOk === true);
  ok("runner has no approval or publish operation", !("approve" in store) && !("publish" in store));

  const corruptedModel: ExtractionModel = {
    ...model,
    name: "corrupted-fixture",
    async extract() {
      const fields: Record<string, { value: string; quote: string | null }> = {};
      for (const key of Object.keys(EXTRACTION_FIELDS)) fields[key] = { value: "Unknown", quote: null };
      fields.integrity_echo = { value: "wrong sentinel", quote: null };
      return { fields };
    },
  };
  const corruptedReport = await runExtractionBatch({ store, model: corruptedModel });
  const corruptedRow = saved[1] as Record<string, unknown>;
  ok("transit corruption is archived as failed evidence", corruptedReport.saved === 1 && corruptedReport.integrityFailures === 1 && corruptedRow.evidenceOk === false);
  ok("transit failure is visible to officer review", Array.isArray(corruptedRow.bindingFailures) && corruptedRow.bindingFailures.some((failure) => String(failure).includes("transit integrity")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
