import { loadTaxonomy } from "../../lib/pipeline/classify";
import { archiveDiscoveryLead } from "../../lib/pipeline/lead-store-supabase";
import { isRecognizedAtsHost } from "../../lib/pipeline/ats-hosts";
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
ok("every lane searches official ATS pages, one host per query", plans.every((plan) => (
  plan.queries.some((query) => query.query.includes("site:myworkdayjobs.com"))
  && plan.queries.some((query) => query.query.includes("site:job-boards.greenhouse.io"))
  && plan.queries.every((query) => (query.query.match(/site:/g) ?? []).length <= 1)
)));
ok("lane queries never require a year, season or degree term", plans.every((plan) => plan.queries.every((query) => (
  !/\b2027\b|\bsummer\b|master's|graduate student|currently enrolled/i.test(query.query)
))));
ok("lane queries never quote a truncated stem", plans.every((plan) => plan.queries.every((query) => (
  !/"(oncolog|immunolog|neurodegener|neurobiolog|bioinformatic|virolog|microbiolog)"/i.test(query.query)
))));
ok("lane queries avoid undocumented grouping and stay short", plans.every((plan) => plan.queries.every((query) => (
  !query.query.includes("(") && query.query.length <= 380
))));
ok("observed ATS families are recognized conservatively", [
  "jobs.jobvite.com", "recruiting.ultipro.com", "example.bamboohr.com", "example.wd1.myworkdayjobs.com", "gilead.yello.co",
].every(isRecognizedAtsHost));
ok("lookalike ATS domains are rejected", !isRecognizedAtsHost("myworkdayjobs.com.example.org")
  && !isRecognizedAtsHost("bamboohr.com.example.org")
  && !isRecognizedAtsHost("yello.co.example.org"));
ok("every lane gets LinkedIn lead discovery", plans.every((plan) => plan.queries.some((query) => query.route === "linkedin_lead")));
ok("queries carry lane-specific vocabulary", plans.every((plan) => plan.keywords.some((keyword) => plan.queries[0].query.includes(keyword))));
ok("lane plans retain both internship and co-op recall", plans.every((plan) => (
  plan.queries[0].query.includes("internship") && plan.queries[0].query.includes("co-op")
)));

const employerPlan = buildEmployerSearchPlan({
  employer: "Johnson & Johnson",
  careersDomain: "https://careers.jnj.com/en/jobs",
  cycleYear: 2027,
});
ok("employer tenant search needs no title vocabulary, so generic technology co-ops are reachable",
  employerPlan.queries.some((query) => /^site:www\.careers\.jnj\.com intern OR interns OR internship OR co-op$/.test(query.query)));
ok("employer inventory also searches the configured careers host", employerPlan.careersDomain === "careers.jnj.com"
  && employerPlan.queries.some((query) => query.query.startsWith("site:careers.jnj.com")));
ok("employer inventory searches LinkedIn job pages and employer hiring posts", employerPlan.queries.some((query) => query.query.startsWith("site:linkedin.com/jobs/view"))
  && employerPlan.queries.some((query) => query.query.startsWith("site:linkedin.com/posts")));
ok("employer recall arms carry no year or degree; the graduate arm is opt-in", employerPlan.queries.every((query) => !/2027|master's/.test(query.query))
  && buildEmployerSearchPlan({ employer: "Johnson & Johnson", cycleYear: 2027, graduateArm: true }).queries.some((query) => query.query.includes("master's")));

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
