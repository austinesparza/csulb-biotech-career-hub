import { loadTaxonomy } from "../../lib/pipeline/classify";
import { archiveDiscoveryLead } from "../../lib/pipeline/lead-store-supabase";
import { buildEmployerSearchPlan, buildLaneSearchPlans, resolveLead } from "../../lib/pipeline/search-plan";

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = "") => {
  condition ? pass++ : fail++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  -> ${detail}`}`);
};

const taxonomy = loadTaxonomy();
const plans = buildLaneSearchPlans(taxonomy, 2027);
ok("every taxonomy lane gets a plan", plans.length === taxonomy.lanes.length, `${plans.length}/${taxonomy.lanes.length}`);
ok("every lane searches official ATS pages", plans.every((plan) => plan.queries.some((query) => query.query.includes("boards.greenhouse.io"))));
ok("every lane gets LinkedIn lead discovery", plans.every((plan) => plan.queries.filter((query) => query.route === "linkedin_lead").length === 2));
ok("queries carry lane-specific vocabulary", plans.every((plan) => plan.keywords.some((keyword) => plan.queries[0].query.includes(keyword))));

const employerPlan = buildEmployerSearchPlan({
  employer: "Johnson & Johnson",
  careersDomain: "https://careers.jnj.com/en/jobs",
  cycleYear: 2027,
});
ok("employer inventory catches generic technology co-ops", employerPlan.queries.some((query) => query.query.includes('"technology co-op"')));
ok("employer inventory searches the official careers host", employerPlan.careersDomain === "careers.jnj.com" && employerPlan.queries[0].query.startsWith("site:careers.jnj.com"));
ok("employer inventory also searches LinkedIn leads", employerPlan.queries.filter((query) => query.route === "linkedin_lead").length === 2);

const resolved = resolveLead({
  originalUrl: "https://www.linkedin.com/jobs/view/123",
  canonicalEmployerUrl: "https://careers.example.com/jobs/123",
  originalRoute: "linkedin_lead",
  originalReachable: true,
});
ok("LinkedIn lead resolves to official evidence", resolved.resolution === "official_source_found" && !!resolved.canonicalEmployerUrl);

const unresolved = resolveLead({
  originalUrl: "https://www.linkedin.com/jobs/view/456",
  originalRoute: "linkedin_lead",
  originalReachable: true,
});
ok("LinkedIn-only lead is retained, not treated as proof", unresolved.resolution === "linkedin_only" && /retained/.test(unresolved.archiveReason));

const malformed = resolveLead({
  originalUrl: "not a valid URL",
  originalRoute: "web_search",
  originalReachable: true,
});
ok("malformed lead URL is archived instead of crashing the run", malformed.resolution === "unresolved" && /retained/.test(malformed.archiveReason));

let rpcName = "";
let rpcParams: Record<string, unknown> = {};
const fakeDb = {
  async rpc(name: string, params: Record<string, unknown>) {
    rpcName = name;
    rpcParams = params;
    return { data: "lead-1", error: null };
  },
};
const archivedId = await archiveDiscoveryLead(fakeDb as never, {
  runId: "lane-genomics-2027-01-01",
  route: "linkedin_lead",
  query: "site:linkedin.com/jobs/view genomics intern",
  lane: "genomics",
  originalUrl: "https://www.linkedin.com/jobs/view/456",
  normalizedUrl: "https://linkedin.com/jobs/view/456",
  visibleTitle: "Genomics Intern",
  visibleSnippet: "Graduate internship lead",
  employerHint: "Example Biotech",
  originalReachable: true,
  resolution: "linkedin_only",
  canonicalEmployerUrl: null,
  archiveReason: unresolved.archiveReason,
  rawMetadata: { rank: 3 },
  retrievedAt: "2027-01-01T12:00:00.000Z",
});
ok("lead observation is sent only to the private archive RPC", archivedId === "lead-1" && rpcName === "archive_discovery_lead");
ok("archive call carries stable keys and raw metadata", String(rpcParams.p_lead_key).length === 64 && String(rpcParams.p_observation_key).length === 64 && (rpcParams.p_raw_metadata as Record<string, unknown>).rank === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
