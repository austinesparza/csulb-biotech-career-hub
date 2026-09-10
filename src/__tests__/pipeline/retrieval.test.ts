import fs from "node:fs";
import { BM25, tokenize, cosine, vectorSearch, reciprocalRankFusion, HybridRetriever, type Doc, type Embedder } from "../../lib/pipeline/retrieval";
import { recallAt, precisionAt, ndcgAt, mrr, compare, formatComparison, type BenchCase } from "../../lib/pipeline/eval/retrieval-bench";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

console.log("=== Tokenizer ===\n");
ok("lowercases and splits", tokenize("Single-Cell RNA Analysis").includes("single-cell"), tokenize("Single-Cell RNA Analysis").join(","));
ok("unifies plurals", tokenize("genomics variants")[1] === tokenize("genomics variant")[1], tokenize("genomics variants").join(","));
ok("handles slashes", tokenize("R/Bioconductor").length === 2, tokenize("R/Bioconductor").join(","));
ok("keeps 'R' — it is a language here, not noise", tokenize("Python and R required").includes("r"), tokenize("Python and R required").join(","));
ok("still drops meaningless single letters", !tokenize("a b of").includes("b"), tokenize("a b of").join(","));
ok("drops single chars", !tokenize("a b cd").includes("a"));

console.log("\n=== BM25 correctness ===\n");
{
  const docs: Doc[] = [
    { id: "d1", text: "genomics genomics genomics sequencing intern" },
    { id: "d2", text: "genomics intern" },
    { id: "d3", text: "oncology biomarker research intern" },
    { id: "d4", text: "a very long document about many unrelated topics including logistics scheduling accounting marketing and general operations across the enterprise with genomics mentioned once" },
  ];
  const bm25 = new BM25(docs);
  const r = bm25.search("genomics");
  ok("term frequency raises rank", r[0].id === "d1", r.map((x) => x.id).join(","));
  ok("documents without the term are excluded", !r.some((x) => x.id === "d3"), r.map((x) => x.id).join(","));
  ok("length normalisation penalises the long doc", r.findIndex((x) => x.id === "d4") > r.findIndex((x) => x.id === "d2"), r.map((x) => x.id).join(","));
  ok("ranks are 1-based and contiguous", r.every((x, i) => x.rank === i + 1));

  // A term in every document carries no discriminating power.
  const common = new BM25([{ id: "a", text: "intern" }, { id: "b", text: "intern" }, { id: "c", text: "intern" }]);
  const scores = common.search("intern").map((x) => x.score);
  ok("IDF stays non-negative for universal terms", scores.every((s) => s >= 0), JSON.stringify(scores));

  ok("empty query returns nothing", bm25.search("").length === 0);
  ok("unmatched query returns nothing", bm25.search("zzzznotaword").length === 0);
  ok("empty corpus does not throw", new BM25([]).search("anything").length === 0);
}

console.log("\n=== Cosine and vector search ===\n");
{
  ok("identical vectors = 1", close(cosine([1, 2, 3], [1, 2, 3]), 1));
  ok("orthogonal = 0", close(cosine([1, 0], [0, 1]), 0));
  ok("opposite = -1", close(cosine([1, 0], [-1, 0]), -1));
  ok("magnitude does not matter", close(cosine([1, 1], [5, 5]), 1));
  ok("zero vector yields 0, not NaN", cosine([0, 0], [1, 1]) === 0);
  let threw = false;
  try { cosine([1, 2], [1, 2, 3]); } catch { threw = true; }
  ok("dimension mismatch throws", threw);

  const docs: Doc[] = [
    { id: "near", text: "x", vector: [1, 0, 0] },
    { id: "mid", text: "y", vector: [0.7, 0.7, 0] },
    { id: "far", text: "z", vector: [0, 0, 1] },
    { id: "novec", text: "w" },
  ];
  const v = vectorSearch([1, 0, 0], docs, 50, -1); // floor disabled to test ordering
  const floored = vectorSearch([1, 0, 0], docs);
  ok("similarity floor excludes unrelated docs", floored.length === 2 && !floored.some((x) => x.id === "far"), floored.map((x) => x.id).join(","));
  ok("orders by similarity", v.map((x) => x.id).join(",") === "near,mid,far", v.map((x) => x.id).join(","));
  ok("skips docs without vectors", !v.some((x) => x.id === "novec"));
}

console.log("\n=== Reciprocal rank fusion ===\n");
{
  const a = [{ id: "x", score: 9, rank: 1 }, { id: "y", score: 5, rank: 2 }];
  const b = [{ id: "y", score: 0.9, rank: 1 }, { id: "z", score: 0.8, rank: 2 }];
  const fused = reciprocalRankFusion([{ name: "lex", results: a }, { name: "vec", results: b }]);
  ok("appearing in both lists wins", fused[0].id === "y", fused.map((f) => f.id).join(","));
  ok("records which lists contributed", fused[0].contributors.sort().join(",") === "lex,vec", fused[0].contributors.join(","));
  ok("single-list docs still included", fused.some((f) => f.id === "x") && fused.some((f) => f.id === "z"));
  ok("incomparable score scales do not matter", fused[0].id === "y");

  // Weighting must actually shift the outcome.
  const weighted = reciprocalRankFusion([{ name: "lex", results: a, weight: 10 }, { name: "vec", results: b, weight: 0.1 }]);
  ok("weights change the ordering", weighted[0].id === "x", weighted.map((f) => f.id).join(","));

  const kSmall = reciprocalRankFusion([{ name: "lex", results: a }], { k: 1 });
  const kBig = reciprocalRankFusion([{ name: "lex", results: a }], { k: 1000 });
  ok("small k sharpens the top-rank advantage", (kSmall[0].score / kSmall[1].score) > (kBig[0].score / kBig[1].score));
  ok("empty input is safe", reciprocalRankFusion([]).length === 0);
}

console.log("\n=== Ranking metrics ===\n");
{
  const results = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, score: 5 - i, rank: i + 1 }));
  ok("recall@k counts relevant in top k", close(recallAt(results, ["a", "e"], 3), 0.5), String(recallAt(results, ["a", "e"], 3)));
  ok("recall@k=5 finds both", close(recallAt(results, ["a", "e"], 5), 1));
  ok("precision@k", close(precisionAt(results, ["a", "b"], 4), 0.5));
  ok("mrr uses the first hit", close(mrr(results, ["c"]), 1 / 3));
  ok("mrr is 0 when nothing relevant", mrr(results, ["zzz"]) === 0);
  ok("perfect ranking gives ndcg 1", close(ndcgAt(results, ["a", "b"], 5), 1));
  ok("worse ranking gives lower ndcg", ndcgAt(results, ["d", "e"], 5) < ndcgAt(results, ["a", "b"], 5));
  ok("graded relevance respected", ndcgAt(results, ["a", "b"], 5, { a: 3, b: 1 }) > ndcgAt(results, ["a", "b"], 5, { a: 1, b: 3 }));
  ok("empty relevant set is vacuously full recall", recallAt(results, [], 5) === 1);
}

console.log("\n=== Graceful degradation ===\n");
{
  const docs: Doc[] = [{ id: "d1", text: "genomics intern" }, { id: "d2", text: "oncology intern" }];
  const noEmbedder = await new HybridRetriever(docs, null).search("genomics");
  ok("no embedder -> lexical only, still returns results", noEmbedder.mode === "lexical_only" && noEmbedder.results.length > 0, JSON.stringify(noEmbedder));
  ok("degradation reason stated", /no embedder/.test(noEmbedder.note ?? ""));

  const unembedded: Embedder = { name: "fake", dimensions: 3, embed: async (t) => t.map(() => [1, 0, 0]) };
  const noVectors = await new HybridRetriever(docs, unembedded).search("genomics");
  ok("embedder but no doc vectors -> lexical only", noVectors.mode === "lexical_only" && /no documents have embeddings/.test(noVectors.note ?? ""));

  const broken: Embedder = { name: "broken", dimensions: 3, embed: async () => { throw new Error("provider 503"); } };
  const withVecs: Doc[] = docs.map((d) => ({ ...d, vector: [1, 0, 0] }));
  const failed = await new HybridRetriever(withVecs, broken).search("genomics");
  ok("embedding failure falls back rather than throwing", failed.mode === "lexical_only" && failed.results.length > 0);
  ok("failure reason surfaced", /provider 503/.test(failed.note ?? ""), failed.note);
}

console.log("\n=== Benchmark harness: does it actually decide? ===\n");
{
  const corpus: Doc[] = [
    { id: "p1", text: "Research Intern, Early Detection Assays. circulating tumor DNA fragmentation and methylation signatures." },
    { id: "p2", text: "Summer Research Intern, Functional Screening. pooled genome-wide CRISPR knockout screens in cancer cell lines." },
    { id: "p3", text: "Computational Intern, Atlas Program. scRNA-seq and CITE-seq datasets using scanpy." },
    { id: "p4", text: "Marketing Intern. campaigns for our product line." },
    { id: "p5", text: "Facilities Intern. vendor coordination and scheduling." },
  ];
  const cases: BenchCase[] = [
    { query: "circulating tumor DNA", relevant: ["p1"] },
    { query: "CRISPR screen", relevant: ["p2"] },
    { query: "single cell analysis", relevant: ["p3"], note: "the posting never says 'single cell' — lexical should miss this" },
  ];

  // An embedder that genuinely knows "single cell" ~ "scRNA-seq".
  const semantic: Record<string, number[]> = {
    "circulating tumor DNA": [1, 0, 0], "CRISPR screen": [0, 1, 0], "single cell analysis": [0, 0, 1],
    p1: [1, 0, 0], p2: [0, 1, 0], p3: [0, 0, 1], p4: [-1, -1, -1], p5: [-1, -1, -1],
  };
  const embedder: Embedder = { name: "oracle", dimensions: 3, embed: async (texts) => texts.map((t) => semantic[t] ?? [0, 0, 0]) };
  const embedded = corpus.map((d) => ({ ...d, vector: semantic[d.id] }));

  const lexOnly = await compare(embedded, cases, null);
  ok("no embedder -> verdict says the run proves nothing", !lexOnly.worthIt && /proves nothing/.test(lexOnly.verdict), lexOnly.verdict);

  // A similarity floor keeps the semantic arm from dragging in every document,
  // which is what tanked precision on the first run of this benchmark.
  const hybrid = await compare(embedded, cases, embedder);
  ok("lexical alone misses the paraphrased query", hybrid.arms[0].totalMisses.includes("single cell analysis"), JSON.stringify(hybrid.arms[0].totalMisses));
  ok("hybrid recovers it", !hybrid.arms[1].totalMisses.includes("single cell analysis"), JSON.stringify(hybrid.arms[1].totalMisses));
  ok("verdict recommends shipping", hybrid.worthIt && /Ships/.test(hybrid.verdict), hybrid.verdict);
  ok("delta table covers every metric", hybrid.delta.length === 7);
  console.log("\n" + formatComparison(hybrid).split("\n").slice(0, 6).join("\n"));

  // A useless embedder must NOT be recommended just because it is new tech.
  const noise: Embedder = { name: "noise", dimensions: 3, embed: async (t) => t.map(() => [0.577, 0.577, 0.577]) };
  const noiseDocs = corpus.map((d) => ({ ...d, vector: [0.577, 0.577, 0.577] }));
  const useless = await compare(noiseDocs, cases, noise);
  ok("a useless embedder is rejected, not shipped", !useless.worthIt, useless.verdict);

  // A harmful embedder that loses a previously-found result must be caught.
  const harmfulDocs = corpus.map((d) => ({ ...d, vector: d.id === "p4" || d.id === "p5" ? [1, 1, 1] : [-1, -1, -1] }));
  const harmful: Embedder = { name: "inverted", dimensions: 3, embed: async (t) => t.map(() => [1, 1, 1]) };
  const bad = await compare(harmfulDocs, cases, harmful);
  ok("does not ship when metrics do not clear the bar", !bad.worthIt, bad.verdict);

  // Precision regression must block a ship even when recall improves.
  const noisyDocs = embedded.map((d) => ({ ...d, vector: semantic[d.id] }));
  const floodEmbedder: Embedder = { name: "flood", dimensions: 3, embed: async (t) => t.map(() => [0.577, 0.577, 0.577]) };
  const flooded = await compare(noisyDocs, cases, floodEmbedder, { maxPrecisionLoss: 0.05 });
  ok("precision regression blocks the ship", !flooded.worthIt, flooded.verdict);
}

console.log("\n=== Against the real must-not-miss corpus ===\n");
{
  const set = JSON.parse(fs.readFileSync("src/lib/pipeline/eval/must-not-miss.json", "utf8"));
  const docs: Doc[] = set.cases.map((c: any) => ({ id: c.id, text: `${c.title} ${c.employer} ${c.body}` }));
  const bm25 = new BM25(docs);
  const hits = bm25.search("single cell RNA sequencing analysis");
  ok("BM25 runs on the real corpus", hits.length > 0, String(hits.length));
  // DOCUMENTED FINDING, not a bug: BM25 ranks the vaccine posting first for
  // "single cell RNA sequencing analysis" because "T cell receptor sequencing"
  // matches the tokens `cell` and `sequenc` in a short document, while the real
  // single-cell posting writes `scRNA-seq` — one token that matches none of the
  // query's. Compound domain terms are exactly where lexical retrieval fails,
  // and exactly what the hybrid benchmark exists to fix.
  ok("lexical ranks the WRONG posting first for a compound term", hits[0].id === "mnm-10-vaccine-immuno", hits[0].id);
  ok("the true single-cell posting is not even in the top 3", !hits.slice(0, 3).some((h) => h.id === "mnm-04-single-cell-euphemism"), hits.slice(0, 3).map((h) => h.id).join(","));
  ok("exact platform vocabulary still works", new BM25(docs).search("scRNA-seq scanpy")[0].id === "mnm-04-single-cell-euphemism", new BM25(docs).search("scRNA-seq scanpy").slice(0,2).map(h=>h.id).join(","));
  const ctdna = bm25.search("liquid biopsy early cancer detection");
  ok("finds the ctDNA posting", ctdna.some((h) => h.id === "mnm-01-ctdna-no-cancer-word"), ctdna.slice(0, 3).map((h) => h.id).join(","));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
