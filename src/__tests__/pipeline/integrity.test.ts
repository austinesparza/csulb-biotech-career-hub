import { makeSentinel, checkEcho, diagnose, withSentinel, type BindingObservation } from "../../lib/pipeline/integrity";
import { buildPortfolio, sampleForAudit, estimateCoverage, type QueryResult, type RejectRecord } from "../../lib/pipeline/portfolio";
import { loadTaxonomy, classify } from "../../lib/pipeline/classify";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };
const tax = loadTaxonomy();

console.log("=== Transit integrity: active sentinel ===\n");
{
  const s = makeSentinel("a1b2");
  ok("intact echo passes", checkEcho(s, s).ok);
  ok("missing echo caught", checkEcho(s, null).reason === "missing");
  ok("empty echo caught", checkEcho(s, "   ").reason === "missing");

  // Simulate a compressor stripping filler words -- exactly what Caveman-style
  // output rules and Headroom-style proxies do.
  const compressed = s.replace(/\b(a|the|this|please|entire|back|as written|including the words)\b/gi, "").replace(/\s+/g, " ").trim();
  ok("compressor-stripped echo caught", !checkEcho(s, compressed).ok, JSON.stringify(checkEcho(s, compressed)));

  const truncated = s.slice(0, Math.floor(s.length * 0.5));
  ok("truncated echo caught as truncated", checkEcho(s, truncated).reason === "truncated");

  const { prompt, sentinel } = withSentinel("Extract fields.\n\n<<<POSTING\ntext\nPOSTING", "n0nce");
  ok("sentinel precedes the posting fence", prompt.indexOf(sentinel) < prompt.indexOf("<<<POSTING"));
  ok("sentinel sits outside the untrusted fence", !prompt.split("<<<POSTING")[1].includes(sentinel));
}

console.log("\n=== Transit integrity: passive diagnosis ===\n");
const obs = (source: string, unbound: number, total = 10): BindingObservation =>
  ({ candidateId: `${source}-${Math.random()}`, source, totalFields: total, unboundFields: unbound, at: Date.now() });
{
  const healthy = [obs("greenhouse", 0), obs("lever", 1), obs("ashby", 0), obs("usajobs", 0), obs("page", 1)];
  ok("healthy run diagnosed healthy", diagnose(healthy).verdict === "healthy", diagnose(healthy).verdict);

  // Every source failing near-totally at once: something rewrote the payload.
  const corrupted = ["greenhouse", "lever", "ashby", "usajobs", "page", "greenhouse"].map((s) => obs(s, 10));
  const cReport = diagnose(corrupted);
  ok("total cross-source failure = transit corruption", cReport.verdict === "transit_corruption", cReport.verdict);
  ok("advice says do NOT swap models", /do NOT swap models/i.test(cReport.explanation));
  ok("advice names the likely culprits", /Headroom|OmniRoute|Caveman/.test(cReport.explanation));

  // One source broken, others fine: that source's page changed.
  const drift = [obs("greenhouse", 0), obs("greenhouse", 1), obs("jefferson-page", 9), obs("jefferson-page", 10), obs("lever", 0), obs("ashby", 1)];
  const dReport = diagnose(drift);
  ok("one bad source = source drift", dReport.verdict === "source_drift", dReport.verdict);
  ok("names the affected source only", dReport.affectedSources.length === 1 && dReport.affectedSources[0] === "jefferson-page", JSON.stringify(dReport.affectedSources));

  // Scattered partial failures everywhere: a model or prompt regression.
  const modelIssue = ["greenhouse", "lever", "ashby", "usajobs", "page", "lever"].map((s) => obs(s, 4));
  const mReport = diagnose(modelIssue);
  ok("scattered partial failure = model quality", mReport.verdict === "model_quality", mReport.verdict);
  ok("advice says run the golden set first", /golden set/i.test(mReport.explanation));

  ok("refuses to diagnose on a tiny sample", diagnose([obs("a", 10)]).verdict === "healthy");
}

console.log("\n=== Query portfolios: marginal unique yield ===\n");
{
  // The exact anti-pattern the review named: three near-identical queries.
  const correlated: QueryResult[] = [
    { query: "single-cell intern", hits: ["p1", "p2", "p3", "p4"], cost: 1 },
    { query: "single-cell internship", hits: ["p1", "p2", "p3", "p4"], cost: 1 },
    { query: "single cell intern", hits: ["p1", "p2", "p3"], cost: 1 },
    { query: "spatial transcriptomics intern", hits: ["p5", "p6"], cost: 1 },
    { query: "scRNA-seq summer", hits: ["p3", "p7"], cost: 1 },
  ];
  const p = buildPortfolio(correlated);
  ok("keeps one of three near-duplicates", p.selected.filter((s) => s.query.includes("single")).length === 1, p.selected.map((s) => s.query).join(" | "));
  ok("keeps the genuinely additive queries", p.selected.some((s) => s.query.includes("spatial")) && p.selected.some((s) => s.query.includes("scRNA")), p.selected.map((s) => s.query).join(" | "));
  ok("rejects duplicates with a stated reason", p.rejected.some((r) => /no unique results/.test(r.reason)), JSON.stringify(p.rejected));
  ok("rejection names what it overlaps", p.rejected[0]?.overlapsWith.length > 0, JSON.stringify(p.rejected[0]));
  ok("full coverage still reached", p.coverage === 1, String(p.coverage));
  ok("cost is lower than running everything", p.totalCost < correlated.length, `${p.totalCost} vs ${correlated.length}`);
  ok("efficiency reported as unique-per-cost", p.efficiency > 1, String(p.efficiency));

  // An expensive query that finds a lot should still beat a cheap useless one.
  const mixed: QueryResult[] = [
    { query: "cheap-useless", hits: ["x1"], cost: 1 },
    { query: "expensive-broad", hits: ["x1", "x2", "x3", "x4", "x5", "x6"], cost: 3 },
  ];
  const pm = buildPortfolio(mixed);
  ok("cost-aware selection picks the broad query first", pm.selected[0].query === "expensive-broad", pm.selected.map((s) => s.query).join(","));

  const none = buildPortfolio([{ query: "a", hits: [], cost: 1 }]);
  ok("a query with no hits is not selected", none.selected.length === 0);
}

console.log("\n=== Reject audit sampling ===\n");
{
  const rejects: RejectRecord[] = Array.from({ length: 40 }, (_, i) => ({
    candidateId: `c${i}`, source: i % 2 ? "greenhouse" : "lever",
    title: `Role ${i}`, employer: `E${i}`, url: `https://x/${i}`,
    dropReason: i < 20 ? "no scientific lane matched" : "scientific lanes matched but no internship or research-function signal",
    score: i, lanesFound: i < 20 ? [] : ["genomics"],
  }));
  const kept = [{ candidateId: "k1", source: "lever", lanesFound: ["genomics"] }, { candidateId: "k2", source: "ashby", lanesFound: ["cancer", "genomics"] }];
  const samples = sampleForAudit(rejects, kept, ["duke-page"]);
  ok("samples all four populations", samples.length === 4 && samples.every((s) => s.why.length > 20));
  const high = samples.find((s) => s.population === "high_confidence_reject")!;
  const low = samples.find((s) => s.population === "low_confidence_reject")!;
  ok("high-confidence = no lanes matched", high.records.every((r) => r.lanesFound.length === 0));
  ok("low-confidence = a lane matched but dropped", low.records.every((r) => r.lanesFound.length > 0));
  ok("single-lane finds surfaced", samples.find((s) => s.population === "single_lane_find")!.records.length === 1);
  ok("zero-yield sources surfaced", samples.find((s) => s.population === "zero_yield_source")!.records[0].source === "duke-page");
  ok("sampling is deterministic (two officers see the same set)",
     JSON.stringify(sampleForAudit(rejects, kept, ["duke-page"])) === JSON.stringify(samples));
}

console.log("\n=== Capture-recapture coverage estimate ===\n");
{
  const heavy = estimateCoverage(["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "f"]);
  const light = estimateCoverage(["a", "b", "c", "d", "e"], ["f", "g", "h", "i", "a"]);
  ok("heavy overlap implies higher coverage", heavy.coverage > light.coverage, `${heavy.coverage.toFixed(2)} vs ${light.coverage.toFixed(2)}`);
  ok("light overlap implies a large unseen population", light.estimatedTotal > heavy.estimatedTotal, `${light.estimatedTotal} vs ${heavy.estimatedTotal}`);
  ok("zero overlap is undefined, not zero", estimateCoverage(["a"], ["b"]).estimatedTotal === Infinity);
  ok("independence caveat always attached", heavy.caveat.includes("not a coverage guarantee"));
}

console.log("\n=== Portfolio built from the real taxonomy ===\n");
{
  // Simulate: do the taxonomy's own query strings actually retrieve differently?
  const corpus = [
    { id: "sc1", text: "single-cell RNA-seq analysis intern with scanpy" },
    { id: "sp1", text: "spatial transcriptomics Visium intern" },
    { id: "gn1", text: "genomics variant calling summer intern" },
    { id: "cn1", text: "oncology biomarker research intern" },
  ];
  // Realistic retrieval: match on the DISTINCTIVE term, not the generic
  // "intern" that appears in every posting. The first version of this test
  // matched on any token >3 chars, so one query swept the whole corpus and the
  // demonstration proved nothing.
  const STOP = new Set(["intern", "internship", "summer", "2027"]);
  const run = (q: string): string[] => {
    const terms = q.toLowerCase().split(/[\s-]+/).filter((t) => t.length > 3 && !STOP.has(t));
    return corpus.filter((d) => terms.some((t) => d.text.toLowerCase().includes(t))).map((d) => d.id);
  };
  const queries = ["single-cell intern", "single cell internship", "spatial transcriptomic intern", "genomics intern", "oncology intern"];
  const p = buildPortfolio(queries.map((q) => ({ query: q, hits: run(q), cost: 1 })));
  ok("each query retrieves a distinct set", new Set(queries.map((q) => run(q).join(","))).size > 1, queries.map((q) => `${q}=[${run(q)}]`).join(" "));
  ok("portfolio smaller than the naive query list", p.selected.length < queries.length, `${p.selected.length} of ${queries.length}`);
  ok("still covers every document", p.coverage === 1, String(p.coverage));
  console.log(`  selected: ${p.selected.map((s) => `${s.query} (+${s.marginalHits})`).join(", ")}`);
  console.log(`  dropped:  ${p.rejected.map((r) => r.query).join(", ")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
