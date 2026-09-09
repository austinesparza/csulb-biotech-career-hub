import fs from "node:fs";
import { scoreCase, aggregate, formatReport, valuesMatch, detectFlips, DEFAULT_GATE } from "../../lib/pipeline/eval/score";
import { EXTRACTION_FIELDS } from "../../lib/pipeline/extraction-schema";
import type { ExtractedField } from "../../lib/pipeline/evidence";

const golden = JSON.parse(fs.readFileSync("src/lib/pipeline/eval/golden-set.json", "utf8"));
const FIELDS = Object.keys(EXTRACTION_FIELDS);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };

const blank = (): Record<string, ExtractedField> =>
  Object.fromEntries(FIELDS.map((f) => [f, { value: "Unknown", quote: null }]));

/** Perfect model: returns exactly the labelled truth, quoting the source. */
const perfect = (c: any) => {
  const out = blank();
  for (const [field, exp] of Object.entries<any>(c.expected)) {
    const quote = exp.quoteContains
      ? (c.rawText.match(new RegExp(`[^.\\n]*${exp.quoteContains.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.\\n]*`, "i"))?.[0] ?? null)
      : null;
    out[field] = { value: exp.value, quote: quote?.trim() ?? null };
    if (!quote) out[field] = { value: "Unknown", quote: null };
  }
  return out;
};

console.log("=== valuesMatch ===\n");
ok("case and punctuation insensitive", valuesMatch("3.0 cumulative required", "GPA 3.0 required"));
ok("substring counts", valuesMatch("Master's students accepted", "Master's students accepted for summer"));
ok("different numbers do NOT match", !valuesMatch("GPA 3.0 required", "GPA 3.5 required"));
ok("pay figures must agree", !valuesMatch("$32.00-$41.00 per hour", "$25.00-$30.00 per hour"));
ok("Unknown vs value is not a match", !valuesMatch("40 hours per week", "Unknown"));
ok("negation flips the verdict", !valuesMatch("Sponsorship available", "No sponsorship available"));
ok("negation both sides still matches", valuesMatch("No visa sponsorship", "no sponsorship provided"));
ok("different phrasing of the same fact matches", valuesMatch("Master's students accepted", "accepts master's students"));
ok("unrelated values do not match", !valuesMatch("40 hours per week", "12 weeks in Columbus"));

console.log("\n=== Perfect model passes the gate ===\n");
{
  const results = golden.cases.flatMap((c: any) => scoreCase(c, perfect(c), FIELDS));
  const report = aggregate(results, FIELDS, { model: "perfect", promptVersion: "v1", cases: golden.cases.length });
  ok("no fabrications", report.overall.fabrications === 0);
  ok("no unbound quotes", report.overall.bindingFailures === 0, JSON.stringify(results.filter((r: any) => r.outcome === "unbound").slice(0, 3)));
  ok("precision 1.0", report.overall.precision === 1, report.overall.precision.toFixed(3));
  ok("gate passed", report.gate.passed, report.gate.failures.join("; "));
}

console.log("\n=== Fabricating model is caught ===\n");
{
  const results = golden.cases.flatMap((c: any) => {
    const out = perfect(c);
    // asserts a value for a field the posting never states
    out.housing_relocation = { value: "Housing stipend provided", quote: "a housing stipend is provided to all interns" };
    return scoreCase(c, out, FIELDS);
  });
  const report = aggregate(results, FIELDS, { model: "fabricator", promptVersion: "v1", cases: golden.cases.length });
  ok("fabrication surfaces as unbound (quote not in source)", report.overall.bindingFailures === 3, String(report.overall.bindingFailures));
  ok("gate FAILED", !report.gate.passed);
  ok("failure names the reason", report.gate.failures.some((f: string) => /unbound/.test(f)), report.gate.failures.join("; "));
}

console.log("\n=== Real-quote fabrication (worst case) ===\n");
{
  // Quotes a real sentence but attaches it to the wrong field: binding passes,
  // only the golden set catches this. This is why evals exist alongside binding.
  const results = golden.cases.flatMap((c: any) => {
    const out = perfect(c);
    if (c.id === "gh-cas-bioinformatics") {
      out.conversion_policy = { value: "Return offers available", quote: "Selected candidates complete a recorded video interview" };
    }
    return scoreCase(c, out, FIELDS);
  });
  const report = aggregate(results, FIELDS, { model: "misattributor", promptVersion: "v1", cases: golden.cases.length });
  ok("caught as fabrication, not as a binding failure", report.overall.fabrications === 1 && report.overall.bindingFailures === 0,
     `fab=${report.overall.fabrications} unbound=${report.overall.bindingFailures}`);
  ok("gate FAILED on zero-fabrication policy", !report.gate.passed);
}

console.log("\n=== Wrong value on a critical field ===\n");
{
  const results = golden.cases.flatMap((c: any) => {
    const out = perfect(c);
    if (c.id === "gh-cas-bioinformatics") out.gpa_requirement = { value: "GPA 3.5 required", quote: "A minimum cumulative GPA of 3.0 is required" };
    return scoreCase(c, out, FIELDS);
  });
  const report = aggregate(results, FIELDS, { model: "wrong-number", promptVersion: "v1", cases: golden.cases.length });
  const gpa = report.byField.find((f: any) => f.field === "gpa_requirement")!;
  ok("wrong number recorded", gpa.wrongValue === 1, JSON.stringify(gpa));
  ok("critical-field precision drops below gate", gpa.precision < DEFAULT_GATE.minCriticalPrecision, gpa.precision.toFixed(2));
  ok("gate FAILED naming the field", !report.gate.passed && report.gate.failures.some((f: string) => f.includes("gpa_requirement")), report.gate.failures.join("; "));
}

console.log("\n=== Lazy model: everything Unknown ===\n");
{
  const results = golden.cases.flatMap((c: any) => scoreCase(c, blank(), FIELDS));
  const report = aggregate(results, FIELDS, { model: "lazy", promptVersion: "v1", cases: golden.cases.length });
  ok("no fabrications (honest about ignorance)", report.overall.fabrications === 0);
  ok("recall collapses", report.overall.recall === 0, report.overall.recall.toFixed(2));
  ok("gate FAILED on recall", !report.gate.passed && report.gate.failures.some((f: string) => /recall/.test(f)), report.gate.failures.join("; "));
}

console.log("\n=== Report formatting ===\n");
{
  const results = golden.cases.flatMap((c: any) => scoreCase(c, perfect(c), FIELDS));
  const text = formatReport(aggregate(results, FIELDS, { model: "perfect", promptVersion: "v1", cases: 3 }));
  ok("renders a per-field table", text.includes("masters_eligibility") && text.includes("prec"));
  ok("states the verdict", text.includes("GATE PASSED"));
  console.log("\n" + text.split("\n").slice(0, 10).join("\n"));
}

console.log("\n=== Decision-flip error rate ===\n");
{
  // A pay error and an eligibility error are not the same mistake.
  const payWrong = golden.cases.flatMap((c: any) => {
    const out = perfect(c);
    if (c.id === "gh-cas-bioinformatics") out.pay_range = { value: "$31.00-$41.00 per hour", quote: "$32.00 - $41.00 per hour depending on degree level" };
    return scoreCase(c, out, FIELDS);
  });
  const payReport = aggregate(payWrong, FIELDS, { model: "pay-off-by-one", promptVersion: "v1", cases: 3 });
  ok("a wrong pay figure is NOT a decision flip", payReport.overall.decisionFlips === 0, JSON.stringify(payReport.flips));

  const eligLost = golden.cases.flatMap((c: any) => {
    const out = perfect(c);
    // NIH states citizenship; dropping it reads on the site as "no barrier".
    if (c.id === "nih-sip") out.work_authorization = { value: "Unknown", quote: null };
    return scoreCase(c, out, FIELDS);
  });
  const eligReport = aggregate(eligLost, FIELDS, { model: "drops-citizenship", promptVersion: "v1", cases: 3 });
  ok("dropping a stated restriction IS a flip", eligReport.overall.decisionFlips === 1, JSON.stringify(eligReport.flips));
  ok("phrased without the word 'only' still counts", eligReport.flips[0].expected?.includes("permanent residents") === true, JSON.stringify(eligReport.flips[0]));
  ok("flip direction identified", eligReport.flips[0].kind === "ineligible_to_eligible", eligReport.flips[0]?.kind);
  ok("gate fails on any decision flip", !eligReport.gate.passed && eligReport.gate.failures.some((f: string) => /decision flip/.test(f)), eligReport.gate.failures.join("; "));

  const deadlineLost = golden.cases.flatMap((c: any) => {
    const out = perfect(c);
    if (c.id === "lever-amgen-process") out.deadline = { value: "Unknown", quote: null };
    return scoreCase(c, out, FIELDS);
  });
  const dReport = aggregate(deadlineLost, FIELDS, { model: "drops-deadline", promptVersion: "v1", cases: 3 });
  ok("a lost deadline is a flip", dReport.flips.some((f: any) => f.kind === "deadline_lost"), JSON.stringify(dReport.flips));

  const worst = detectFlips([{ caseId: "x", field: "masters_eligibility", outcome: "fabricated", expected: null, got: "PhD only; not eligible for master's students" }] as never);
  ok("inventing a disqualification is the worst direction", worst[0]?.kind === "eligible_to_ineligible", JSON.stringify(worst));

  const clean = golden.cases.flatMap((c: any) => scoreCase(c, perfect(c), FIELDS));
  const cleanReport = aggregate(clean, FIELDS, { model: "perfect", promptVersion: "v1", cases: 3 });
  ok("perfect model has zero flips", cleanReport.overall.decisionFlips === 0 && cleanReport.gate.passed);
  ok("report prints the flip rate", formatReport(cleanReport).includes("decision flips 0"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
