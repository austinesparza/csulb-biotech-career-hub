/**
 * recall.test.ts — the false-negative gate.
 *
 * Precision-only evaluation is the trap the architecture review names: a system
 * looks accurate while quietly missing the roles that matter. These cases are
 * adversarial on purpose — most describe the work without using the obvious
 * lane word — and every one must survive discovery.
 */
import fs from "node:fs";
import { loadTaxonomy, classify } from "../../lib/pipeline/classify";

const tax = loadTaxonomy();
const mustNotMiss = JSON.parse(fs.readFileSync("src/lib/pipeline/eval/must-not-miss.json", "utf8"));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };

console.log("=== Must-not-miss: every case must be discovered ===\n");
const misses: string[] = [];
for (const c of mustNotMiss.cases) {
  const r = classify({ title: c.title, employer: c.employer, body: c.body }, tax);
  const found = r.lanes.map((l: any) => l.id);
  const laneOk = c.expectLanes.some((l: string) => found.includes(l));
  ok(`${c.id} (${c.why})`, r.keep && laneOk, r.keep ? `lanes ${found.join(",") || "none"}, expected one of ${c.expectLanes.join(",")}` : `DROPPED: ${r.dropReason}`);
  if (!r.keep || !laneOk) misses.push(c.id);
}
ok("recall gate: zero misses", misses.length === 0, misses.join(", "));

console.log("\n=== Precision must not regress while chasing recall ===\n");
const falsePositives = [
  ["Data Science Intern", "Global Capital Partners", "Machine learning models for credit risk and portfolio insights. Python, SQL. Summer internship."],
  ["Oncology Sales Representative Intern", "BigPharma", "Support the oncology sales team with territory analytics."],
  ["Marketing Intern - Genomics Division", "SeqCo", "Support marketing campaigns for our genomics product line."],
  ["Operations Intern", "Logistics Co", "Daily operations and production scheduling. Track growth and survival of accounts."],
  ["Communications Intern", "BioCo", "Write about our cancer research for the public. Storytelling and social media."],
  ["Financial Analyst Intern", "GenomeCorp", "Financial modeling for our sequencing business unit."],
  ["Facilities Intern", "Example Bio", "Support laboratory facilities scheduling and vendor coordination at our clinical site."],
  ["Recruiter Intern", "Example Genomics", "Source candidates for our computational biology and genomics teams."],
];
for (const [title, employer, body] of falsePositives) {
  const r = classify({ title, employer, body }, tax);
  ok(`rejects: ${title}`, !r.keep, `kept with lanes ${r.lanes.map((l: any) => l.id).join(",")}`);
}

console.log("\n=== Cross-lane corroboration: the safety net, and its limits ===\n");
{
  // Vocabulary fixed mnm-03 outright, which is the better fix. Corroboration is
  // the net for the NEXT case where two lanes each hold a single weak signal.
  const variant = mustNotMiss.cases.find((c: any) => c.id === "mnm-03-variant-interpretation");
  const v = classify({ title: variant.title, employer: variant.employer, body: variant.body }, tax);
  ok("mnm-03 now matches on real vocabulary, not corroboration", v.keep && v.corroboratedOnly === false, String(v.corroboratedOnly));

  const weak = classify({
    title: "Summer Intern, Evidence Preparation", employer: "Example Health",
    body: "Support preparation of a regulatory submission summarizing polygenic risk evidence for patient care. Master's students accepted. Summer 2027 internship.",
  }, tax);
  ok("two single-signal lanes in a bio context are kept", weak.keep, weak.dropReason);
  ok("and flagged corroboratedOnly for closer review", weak.corroboratedOnly === true, String(weak.corroboratedOnly));

  const noContext = classify({
    title: "Summer Intern, Evidence Preparation", employer: "Generic Consulting",
    body: "Support preparation of a regulatory submission summarizing polygenic risk evidence. Summer 2027 internship.",
  }, tax);
  ok("the same shape WITHOUT biological context stays dropped", !noContext.keep, noContext.dropReason);

  const strong = classify({ title: "Bioinformatics Summer Intern", employer: "X", body: "Genomics and sequencing analysis. Master's students accepted. Summer internship." }, tax);
  ok("a core-term match is never flagged", strong.keep && !strong.corroboratedOnly);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
