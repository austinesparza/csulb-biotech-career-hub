/**
 * retrieval-bench.ts — the harness that answers "does semantic retrieval
 * actually help on OUR corpus?"
 *
 * The review is explicit that model rankings are corpus-dependent and must be
 * measured locally. This file exists so that question is settled by a number
 * rather than by a vendor claim or an intuition.
 *
 * Nothing here embeds anything. Plug in a real Embedder, run `compare()`, and
 * read the delta. If hybrid does not beat lexical on this corpus, do not ship
 * the extra infrastructure.
 */
import { HybridRetriever, type Doc, type Embedder, type ScoredDoc } from "../retrieval";

export interface BenchCase {
  /** The query a student or a discovery lane would actually issue. */
  query: string;
  /** Doc ids that SHOULD be retrieved. Hand-labelled. */
  relevant: string[];
  /** Optional graded relevance, 0-3. Defaults to 1 for every relevant id. */
  grades?: Record<string, number>;
  note?: string;
}

export function recallAt(results: ScoredDoc[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 1;
  const top = new Set(results.slice(0, k).map((r) => r.id));
  return relevant.filter((id) => top.has(id)).length / relevant.length;
}

export function precisionAt(results: ScoredDoc[], relevant: string[], k: number): number {
  const top = results.slice(0, k);
  if (top.length === 0) return 0;
  const rel = new Set(relevant);
  return top.filter((r) => rel.has(r.id)).length / top.length;
}

/** Mean reciprocal rank of the first relevant hit. */
export function mrr(results: ScoredDoc[], relevant: string[]): number {
  const rel = new Set(relevant);
  const index = results.findIndex((r) => rel.has(r.id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export function ndcgAt(results: ScoredDoc[], relevant: string[], k: number, grades?: Record<string, number>): number {
  const grade = (id: string) => grades?.[id] ?? (relevant.includes(id) ? 1 : 0);
  const dcg = results.slice(0, k).reduce((sum, r, i) => sum + grade(r.id) / Math.log2(i + 2), 0);
  const ideal = [...relevant].map(grade).sort((a, b) => b - a).slice(0, k);
  const idcg = ideal.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

export interface ArmResult {
  arm: string;
  recallAt10: number; recallAt20: number; recallAt50: number;
  precisionAt10: number; ndcgAt10: number; ndcgAt20: number; mrr: number;
  /** Cases where NOTHING relevant was retrieved at all. The failures that matter. */
  totalMisses: string[];
}

async function runArm(name: string, retriever: HybridRetriever, cases: BenchCase[]): Promise<ArmResult> {
  const rows: { c: BenchCase; results: ScoredDoc[] }[] = [];
  for (const c of cases) {
    const { results } = await retriever.search(c.query, { limit: 50 });
    rows.push({ c, results });
  }
  const mean = (f: (row: { c: BenchCase; results: ScoredDoc[] }) => number) =>
    rows.length === 0 ? 0 : Number((rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(4));
  return {
    arm: name,
    recallAt10: mean((r) => recallAt(r.results, r.c.relevant, 10)),
    recallAt20: mean((r) => recallAt(r.results, r.c.relevant, 20)),
    recallAt50: mean((r) => recallAt(r.results, r.c.relevant, 50)),
    precisionAt10: mean((r) => precisionAt(r.results, r.c.relevant, 10)),
    ndcgAt10: mean((r) => ndcgAt(r.results, r.c.relevant, 10, r.c.grades)),
    ndcgAt20: mean((r) => ndcgAt(r.results, r.c.relevant, 20, r.c.grades)),
    mrr: mean((r) => mrr(r.results, r.c.relevant)),
    totalMisses: rows.filter((r) => recallAt(r.results, r.c.relevant, 50) === 0).map((r) => r.c.query),
  };
}

export interface ComparisonReport {
  arms: ArmResult[];
  delta: { metric: string; lexical: number; hybrid: number; change: number }[];
  verdict: string;
  worthIt: boolean;
}

/**
 * Run lexical-only against hybrid on the same cases and report the delta.
 * `docs` must already carry vectors for the hybrid arm to mean anything.
 */
export async function compare(
  docs: Doc[],
  cases: BenchCase[],
  embedder: Embedder | null,
  opts: { minRecallGain?: number; maxPrecisionLoss?: number } = {},
): Promise<ComparisonReport> {
  const minGain = opts.minRecallGain ?? 0.03;
  // Recall bought with precision is not free: every extra irrelevant result is
  // an officer-minute. A big precision drop blocks the ship even if recall rose.
  const maxPrecisionLoss = opts.maxPrecisionLoss ?? 0.10;
  const lexical = await runArm("lexical", new HybridRetriever(docs, null), cases);
  const hybrid = await runArm("hybrid", new HybridRetriever(docs, embedder), cases);

  const metrics: (keyof ArmResult)[] = ["recallAt10", "recallAt20", "recallAt50", "precisionAt10", "ndcgAt10", "ndcgAt20", "mrr"];
  const delta = metrics.map((m) => ({
    metric: m as string,
    lexical: lexical[m] as number,
    hybrid: hybrid[m] as number,
    change: Number(((hybrid[m] as number) - (lexical[m] as number)).toFixed(4)),
  }));

  const recallGain = hybrid.recallAt20 - lexical.recallAt20;
  const precisionLoss = lexical.precisionAt10 - hybrid.precisionAt10;
  const missesFixed = lexical.totalMisses.filter((q) => !hybrid.totalMisses.includes(q));
  const missesIntroduced = hybrid.totalMisses.filter((q) => !lexical.totalMisses.includes(q));

  let verdict: string;
  let worthIt: boolean;
  if (!embedder) {
    verdict = "No embedder supplied. The hybrid arm is identical to lexical; this run proves nothing about semantic retrieval.";
    worthIt = false;
  } else if (missesIntroduced.length > 0) {
    verdict = `Hybrid introduced ${missesIntroduced.length} total miss(es) that lexical found: ${missesIntroduced.join("; ")}. Investigate before shipping — a retrieval change that loses a previously-found role is a regression regardless of aggregate metrics.`;
    worthIt = false;
  } else if (precisionLoss > maxPrecisionLoss) {
    verdict = `Hybrid loses ${(precisionLoss * 100).toFixed(1)} points of precision@10 (recall change ${(recallGain * 100).toFixed(1)}). Every extra irrelevant result costs an officer minute, so this does not ship as configured. Try a similarity floor on the semantic arm, or a lower semantic weight in fusion.`;
    worthIt = false;
  } else if (recallGain >= minGain) {
    verdict = `Hybrid improves recall@20 by ${(recallGain * 100).toFixed(1)} points${missesFixed.length ? ` and recovers ${missesFixed.length} query(s) lexical missed entirely` : ""}. Ships.`;
    worthIt = true;
  } else {
    verdict = `Hybrid changes recall@20 by only ${(recallGain * 100).toFixed(1)} points, below the ${(minGain * 100).toFixed(0)}-point bar. The added infrastructure is not justified on this corpus yet. Revisit when the corpus grows or the queries get less literal.`;
    worthIt = false;
  }

  return { arms: [lexical, hybrid], delta, verdict, worthIt };
}

export function formatComparison(report: ComparisonReport): string {
  const lines = ["metric            lexical   hybrid    change"];
  for (const d of report.delta) {
    const arrow = d.change > 0.0001 ? "+" : d.change < -0.0001 ? "" : " ";
    lines.push(`${d.metric.padEnd(16)} ${d.lexical.toFixed(3).padStart(7)}  ${d.hybrid.toFixed(3).padStart(7)}  ${arrow}${d.change.toFixed(3)}`);
  }
  const [lexical, hybrid] = report.arms;
  lines.push("");
  lines.push(`total misses: lexical ${lexical.totalMisses.length}, hybrid ${hybrid.totalMisses.length}`);
  lines.push("");
  lines.push(report.verdict);
  return lines.join("\n");
}
