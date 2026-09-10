import { defaultConnector, SourceTierStore, sourceGovernanceError, staticPageResult, type RunnableJobSource } from "../../lib/ingestion/source-runner";

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = "") => {
  condition ? pass++ : fail++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  -> ${detail}`}`);
};

const source: RunnableJobSource = {
  id: "source-1",
  source_name: "Example Biotech",
  source_kind: "static_html",
  source_identifier: null,
  careers_url: "https://example.org/careers",
  api_endpoint: null,
  config_json: {},
  enabled: true,
  terms_reviewed: true,
  terms_review_date: "2026-09-10",
  robots_reviewed: true,
  automatic_scheduling_paused_at: null,
  consecutive_failures: 0,
  fetch_tier: 0,
  tier_clean_runs: 0,
};

console.log("=== Static page becomes an archived observation ===\n");
{
  const html = `<html><head><title>Student programs</title></head><body><main>${"Public career information. ".repeat(20)}</main></body></html>`;
  const result = staticPageResult(source, html, {
    status: 200,
    body: html,
    etag: null,
    lastModified: null,
    tier: 1,
    tierName: "scrapling",
    attempts: [{ tier: 0, error: "JS-rendered shell" }],
  });
  ok("keeps the page even when graduate relevance is weak", result.ok && result.candidates.length === 1);
  ok("preserves raw fetch output", result.rawResponseText === html);
  ok("records which fetch tier succeeded", result.ok && (result.candidates[0].sourceMetadata as Record<string, unknown>).fetchTier === 1);
  ok("marks unknown facts instead of inventing them", result.ok && result.candidates[0].uncertaintyFlags.includes("eligibility_missing"));
}

console.log("\n=== Unsupported connector is retained as a failed run ===\n");
{
  const unsupported = { ...source, source_kind: "rss" as const };
  const result = await defaultConnector(unsupported, { db: {} as never });
  ok("does not silently skip unsupported sources", !result.ok && /retained/.test(result.error.message), result.error?.message);
  ok("does not fabricate candidates", !result.ok && result.candidates.length === 0);
}

console.log("\n=== Private source tests preserve governance without enabling scheduling ===\n");
{
  const disabled = { ...source, enabled: false };
  ok("normal runs reject disabled sources", sourceGovernanceError(disabled) === "source is disabled");
  ok("private tests may run a reviewed disabled source", sourceGovernanceError(disabled, true) === null);
  ok("private tests still require terms review", sourceGovernanceError({ ...disabled, terms_reviewed: false, terms_review_date: null }, true) === "source terms review is incomplete");
  ok("private tests still require robots review", sourceGovernanceError({ ...disabled, robots_reviewed: false }, true) === "source robots review is incomplete");
  ok("private tests may run a reviewed paused source without resuming it", sourceGovernanceError({ ...disabled, automatic_scheduling_paused_at: "2026-09-10T00:00:00Z" }, true) === null);
}

console.log("\n=== Private source tests keep adaptive tier state ephemeral ===\n");
{
  let writes = 0;
  const fakeDb = {
    from: () => ({
      update: () => {
        writes += 1;
        return { eq: async () => ({ error: null }) };
      },
    }),
  };
  const privateSource = { ...source };
  await new SourceTierStore(fakeDb as never, privateSource, false).set({ sourceId: source.id, tier: 2, cleanRuns: 1 });
  ok("private tier transitions do not write source state", writes === 0);
  ok("private tier transitions remain available inside the current fetch chain", privateSource.fetch_tier === 2 && privateSource.tier_clean_runs === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
