import fs from "node:fs";
import path from "node:path";
import { CONNECTORS, getConnector } from "../../lib/pipeline/connectors/index";
import { htmlToText, decodeEntities } from "../../lib/pipeline/connectors/types";
import { loadTaxonomy, classify } from "../../lib/pipeline/classify";
import { bindExtraction, normalize } from "../../lib/pipeline/evidence";

const fixture = (name: string) => fs.readFileSync(path.join("src/__tests__/pipeline/fixtures", name), "utf8");
const tax = loadTaxonomy();
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  -> ${detail}`}`);
};

console.log("=== HTML to text ===\n");
ok("decodes nested entities", decodeEntities("Master&amp;#39;s") === "Master&#39;s");
ok("double-decodes escaped markup", htmlToText("&lt;p&gt;Master&amp;#39;s degree&lt;/p&gt;").includes("Master's degree"),
   htmlToText("&lt;p&gt;Master&amp;#39;s degree&lt;/p&gt;"));
ok("list items become separate lines", htmlToText("<ul><li>One</li><li>Two</li></ul>").split("\n").filter(Boolean).length === 2);
ok("strips script content", !htmlToText("<script>alert(1)</script><p>Real text here</p>").includes("alert"));
ok("collapses whitespace", htmlToText("<p>a   \n\n   b</p>") === "a b");

console.log("\n=== Greenhouse ===\n");
const gh = CONNECTORS.greenhouse.parse(fixture("greenhouse.json"), { employer: "CAS", identifier: "example" });
ok("parses both jobs", gh.postings.length === 2, `${gh.postings.length}`);
const ghIntern = gh.postings[0];
ok("title", ghIntern.title === "2027 Bioinformatics Scientist Summer Intern", ghIntern.title);
ok("externalId is stable", ghIntern.externalId === "6543210", ghIntern.externalId);
ok("location mapped", ghIntern.location === "Columbus, OH", ghIntern.location);
ok("department entity decoded", ghIntern.rawText.includes("Research & Development"), ghIntern.rawText.slice(0, 80));
ok("body HTML flattened to readable text", ghIntern.rawText.includes("minimum cumulative GPA of 3.0 is required"), ghIntern.rawText.slice(0, 200));
ok("apostrophe survives double-encoding", ghIntern.rawText.includes("Master's or PhD program"), "");
ok("pay range preserved", ghIntern.rawText.includes("$32.00 - $41.00 per hour"), "");

console.log("\n=== Greenhouse -> classifier ===\n");
const ghClass = classify({ title: ghIntern.title, employer: ghIntern.employer, body: ghIntern.rawText }, tax);
ok("intern kept", ghClass.keep, ghClass.dropReason);
ok("lane = bioinformatics", ghClass.lanes.some((l) => l.id === "bioinformatics"), ghClass.lanes.map((l) => l.id).join(","));
ok("stage = msc_any", ghClass.stage.id === "msc_any", ghClass.stage.id);
ok("gpa + work_authorization surfaced", ["gpa", "work_authorization"].every((g) => ghClass.personalGates.includes(g)), ghClass.personalGates.join(","));
const ghSales = classify({ title: gh.postings[1].title, employer: "CAS", body: gh.postings[1].rawText }, tax);
ok("sales role dropped even though 'genomics' appears", !ghSales.keep, ghSales.dropReason);

console.log("\n=== Evidence quotes survive the real conversion ===\n");
// The point: a model shown rawText must be able to quote it and pass binding.
const bound = bindExtraction({
  masters_eligibility: { value: "Master's or PhD program required", quote: "currently enrolled in a Master's or PhD program in bioinformatics" },
  gpa_requirement: { value: "3.0 required", quote: "minimum cumulative GPA of 3.0 is required" },
  work_authorization: { value: "No sponsorship for internships", quote: "we do not provide visa sponsorship for internships" },
  pay_range: { value: "$32.00-$41.00/hour", quote: "$32.00 - $41.00 per hour depending on degree level" },
  deadline: { value: "Unknown", quote: null },
} as any, ghIntern.rawText);
ok("all quotes bind against converted text", bound.ok, bound.failures.join(" | "));
ok("offsets recorded", typeof bound.fields.gpa_requirement.start === "number");

console.log("\n=== Ashby ===\n");
const ab = CONNECTORS.ashby.parse(fixture("ashby.json"), { employer: "Example Bio", identifier: "example" });
ok("parses", ab.postings.length === 1);
ok("uses documented jobUrl as stable external ID", ab.postings[0].externalId === "https://jobs.ashbyhq.com/example/a1b2c3", ab.postings[0].externalId);
ok("deduplicates primary and secondary locations", ab.postings[0].location === "Cambridge, MA; Boston, MA", ab.postings[0].location);
ok("workplace type is evidence text", ab.postings[0].rawText.includes("Workplace type: OnSite"), "");
ok("unlisted jobs are excluded with a warning", ab.warnings.some((warning) => warning.includes("unlisted")), JSON.stringify(ab.warnings));
ok("compensation folded into text", ab.postings[0].rawText.includes("$28 - $36 / hour"), "");
ok("structured comp kept in extra", ab.postings[0].extra.compensationSummary === "$28 - $36 / hour");
const abClass = classify({ title: ab.postings[0].title, employer: "Example Bio", body: ab.postings[0].rawText }, tax);
ok("lanes include single_cell and cancer", ["single_cell", "cancer"].every((l) => abClass.lanes.some((x) => x.id === l)), abClass.lanes.map((l) => l.id).join(","));
ok("dry-lab methods detected", abClass.methods.dry_lab.some((m) => ["seurat", "scanpy"].includes(m)), abClass.methods.dry_lab.join(","));

console.log("\n=== Lever ===\n");
const lv = CONNECTORS.lever.parse(fixture("lever.json"), { employer: "Amgen", identifier: "example" });
ok("parses", lv.postings.length === 1);
ok("all locations preserved", lv.postings[0].location === "Thousand Oaks, CA; Cambridge, MA", lv.postings[0].location);
ok("workplace type preserved as evidence", lv.postings[0].rawText.includes("Workplace type: onsite"), "");
ok("salary description preserved as evidence", lv.postings[0].rawText.includes("Compensation: $28-$34 per hour"), "");
ok("list content merged into body", lv.postings[0].rawText.includes("completed at least one year"), "");
ok("epoch ms timestamps converted", /^20\d\d-/.test(lv.postings[0].postedAt ?? ""), String(lv.postings[0].postedAt));
const lvClass = classify({ title: lv.postings[0].title, employer: "Amgen", body: lv.postings[0].rawText }, tax);
ok("stage = msc_year2", lvClass.stage.id === "msc_year2", lvClass.stage.id);
ok("lane = bioprocess", lvClass.lanes.some((l) => l.id === "bioprocess"), lvClass.lanes.map((l) => l.id).join(","));
ok("return rule flagged", lvClass.personalGates.includes("return_rule"));

console.log("\n=== USAJOBS ===\n");
const uj = CONNECTORS.usajobs.parse(fixture("usajobs.json"), { employer: "NIH", identifier: "" });
ok("parses", uj.postings.length === 1);
ok("employer from OrganizationName", uj.postings[0].employer === "National Institutes of Health", uj.postings[0].employer);
ok("pay folded in", uj.postings[0].rawText.includes("3800-5200 Per Month"), "");
ok("close date kept", uj.postings[0].extra.closeDate === "2027-02-15");
const ujClass = classify({ title: uj.postings[0].title, employer: uj.postings[0].employer, body: uj.postings[0].rawText }, tax);
ok("kept", ujClass.keep, ujClass.dropReason);
ok("citizenship = personal gate, not structural", ujClass.personalGates.includes("citizenship") && ujClass.structuralGates.length === 0);
ok("bucket = graduate", ujClass.suggestedBucket === "graduate", ujClass.suggestedBucket);

console.log("\n=== Vendor outages must not throw ===\n");
for (const [kind, connector] of Object.entries(CONNECTORS)) {
  if (kind === "page") continue;
  const html = connector.parse("<html><body>503 Service Unavailable</body></html>", { employer: "X", identifier: "y" });
  ok(`${kind}: HTML error page -> warning, no throw`, html.postings.length === 0 && html.warnings.length > 0, JSON.stringify(html.warnings));
  const empty = connector.parse("{}", { employer: "X", identifier: "y" });
  ok(`${kind}: empty object -> warning, no throw`, empty.postings.length === 0 && empty.warnings.length > 0);
}
const shortPage = CONNECTORS.page.parse("<html><body><div id=root></div></body></html>", { employer: "Uni", identifier: "https://x.edu/p" });
ok("page: JS-rendered shell flagged", shortPage.postings.length === 0 && /JS-rendered/.test(shortPage.warnings[0] ?? ""), JSON.stringify(shortPage.warnings));

console.log("\n=== Registry ===\n");
ok("getConnector works", getConnector("greenhouse").kind === "greenhouse");
let threw = false;
try { getConnector("nope"); } catch { threw = true; }
ok("unknown kind throws", threw);
const boardConnectors = Object.values(CONNECTORS).filter((c) => !["page", "usajobs"].includes(c.kind));
ok("board urls are https and encode the identifier",
  boardConnectors.every((c) => c.listUrl("a b/c").startsWith("https://") && !c.listUrl("a b/c").includes(" ")),
  boardConnectors.map((c) => c.listUrl("a b/c")).join(" | "));
const ujUrl = CONNECTORS.usajobs.listUrl(JSON.stringify({ Keyword: "bioinformatics intern", ResultsPerPage: 50 }));
ok("usajobs builds a safe query", ujUrl.startsWith("https://data.usajobs.gov/api/search?") && !ujUrl.includes(" "), ujUrl);
let ujThrew = false;
try { CONNECTORS.usajobs.listUrl("Keyword=x&evil=1"); } catch { ujThrew = true; }
ok("usajobs rejects a raw query string (injection guard)", ujThrew);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
