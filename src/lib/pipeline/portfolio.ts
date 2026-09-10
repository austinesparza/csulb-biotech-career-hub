/**
 * portfolio.ts — query portfolios, not query strings.
 *
 * The architecture review's criticism of the previous `buildQueries()` was
 * exact: "Ten highly correlated Boolean queries are one effective lane, not
 * ten. Reward unique marginal discoveries."
 *
 * The old function emitted `single-cell intern`, `single-cell internship`,
 * `single cell intern` — three queries returning almost identical sets. Counted
 * as three lanes of coverage; worth roughly one.
 *
 * This module scores a candidate query set by MARGINAL unique yield and selects
 * a portfolio greedily, so adding a near-duplicate query earns nothing.
 */

export interface QueryResult {
  query: string;
  /** Ids of relevant items this query surfaced. Relevance judged elsewhere. */
  hits: string[];
  /** Requests, credits or seconds. Any consistent unit. */
  cost: number;
}

export interface PortfolioEntry {
  query: string;
  marginalHits: number;
  marginalPerCost: number;
  cumulativeCoverage: number;
  redundantWith: string[];
}

export interface Portfolio {
  selected: PortfolioEntry[];
  rejected: { query: string; reason: string; overlapsWith: string[] }[];
  coverage: number;
  totalCost: number;
  /** Unique items per unit cost. The number to optimise. */
  efficiency: number;
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
};

/**
 * Greedy selection by marginal value. Each step picks the query adding the most
 * NEW hits per unit cost. Stops when the next query adds nothing useful.
 */
export function buildPortfolio(
  results: QueryResult[],
  opts: { minMarginalHits?: number; maxQueries?: number; redundancyThreshold?: number; universe?: string[] } = {},
): Portfolio {
  const minMarginal = opts.minMarginalHits ?? 1;
  const maxQueries = opts.maxQueries ?? 12;
  const redundancyThreshold = opts.redundancyThreshold ?? 0.85;

  const sets = new Map(results.map((r) => [r.query, new Set(r.hits)]));
  const universe = new Set(opts.universe ?? results.flatMap((r) => r.hits));
  const covered = new Set<string>();
  const selected: PortfolioEntry[] = [];
  const rejected: Portfolio["rejected"] = [];
  const remaining = new Set(results.map((r) => r.query));

  while (selected.length < maxQueries && remaining.size > 0) {
    let best: { query: string; marginal: string[]; perCost: number } | null = null;
    for (const query of remaining) {
      const hits = sets.get(query)!;
      const marginal = [...hits].filter((h) => !covered.has(h));
      const cost = results.find((r) => r.query === query)!.cost || 1;
      const perCost = marginal.length / cost;
      if (!best || perCost > best.perCost || (perCost === best.perCost && marginal.length > best.marginal.length)) {
        best = { query, marginal, perCost };
      }
    }
    if (!best || best.marginal.length < minMarginal) break;

    // Near-duplicate of something already selected? Record why it was skipped.
    const overlaps = selected
      .filter((s) => jaccard(sets.get(best!.query)!, sets.get(s.query)!) >= redundancyThreshold)
      .map((s) => s.query);

    selected.push({
      query: best.query,
      marginalHits: best.marginal.length,
      marginalPerCost: Number(best.perCost.toFixed(3)),
      cumulativeCoverage: 0,
      redundantWith: overlaps,
    });
    for (const hit of best.marginal) covered.add(hit);
    selected[selected.length - 1].cumulativeCoverage = universe.size === 0 ? 1 : covered.size / universe.size;
    remaining.delete(best.query);
  }

  for (const query of remaining) {
    const hits = sets.get(query)!;
    const marginal = [...hits].filter((h) => !covered.has(h));
    const overlaps = selected
      .filter((s) => jaccard(hits, sets.get(s.query)!) >= 0.5)
      .map((s) => s.query);
    rejected.push({
      query,
      reason: marginal.length === 0
        ? "adds no unique results"
        : `adds only ${marginal.length} unique result(s), below the threshold`,
      overlapsWith: overlaps,
    });
  }

  const totalCost = selected.reduce((sum, s) => sum + (results.find((r) => r.query === s.query)!.cost || 1), 0);
  return {
    selected, rejected,
    coverage: universe.size === 0 ? 1 : covered.size / universe.size,
    totalCost,
    efficiency: totalCost === 0 ? 0 : Number((covered.size / totalCost).toFixed(3)),
  };
}

/**
 * Reject audit sampling. The review names four populations that must be sampled
 * weekly and reviewed BLIND, because a precision-only system cannot see its own
 * false negatives.
 */
export interface RejectRecord {
  candidateId: string;
  source: string;
  title: string;
  employer: string;
  url: string;
  dropReason: string;
  /** Classifier score at the time of the drop. Low = the system was unsure. */
  score: number;
  lanesFound: string[];
}

export interface AuditSample {
  population: "high_confidence_reject" | "low_confidence_reject" | "single_lane_find" | "zero_yield_source";
  records: RejectRecord[];
  why: string;
}

export function sampleForAudit(
  rejects: RejectRecord[],
  kept: { candidateId: string; source: string; lanesFound: string[] }[],
  sourcesWithZeroYield: string[],
  perPopulation = 5,
): AuditSample[] {
  const sorted = [...rejects].sort((a, b) => a.score - b.score);
  // Deterministic spread rather than random, so a weekly audit is reproducible
  // and two officers reviewing the same week see the same records.
  const spread = <T,>(items: T[], n: number): T[] => {
    if (items.length <= n) return items;
    const step = items.length / n;
    return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
  };

  const lowConfidence = sorted.filter((r) => r.lanesFound.length > 0);
  const highConfidence = sorted.filter((r) => r.lanesFound.length === 0);

  return [
    {
      population: "high_confidence_reject",
      records: spread(highConfidence, perPopulation),
      why: "The system was certain these were irrelevant. If it is wrong here, it is wrong in a way no metric currently shows.",
    },
    {
      population: "low_confidence_reject",
      records: spread(lowConfidence, perPopulation),
      why: "Matched a lane but was dropped anyway. The most likely place for a real miss.",
    },
    {
      population: "single_lane_find",
      records: kept
        .filter((k) => k.lanesFound.length === 1)
        .slice(0, perPopulation)
        .map((k) => ({ candidateId: k.candidateId, source: k.source, title: "", employer: "", url: "", dropReason: "kept", score: 0, lanesFound: k.lanesFound })),
      why: "Found by only one lane. If that lane breaks, these disappear silently.",
    },
    {
      population: "zero_yield_source",
      records: sourcesWithZeroYield.map((source) => ({ candidateId: "", source, title: "", employer: "", url: "", dropReason: "source returned nothing relevant", score: 0, lanesFound: [] })),
      why: "Produced no relevant results this period. Either genuinely empty, or the parser broke and nobody noticed.",
    },
  ];
}

/**
 * Capture-recapture coverage estimate (Lincoln-Petersen).
 * Treat two discovery lanes as imperfect independent detectors: heavy overlap
 * suggests good coverage, light overlap suggests a large unseen population.
 *
 * The independence assumption is FALSE here -- lanes share sources and
 * vocabulary -- so this is an exploratory lower bound, never proof of coverage.
 */
export function estimateCoverage(laneA: string[], laneB: string[]): { estimatedTotal: number; observed: number; coverage: number; caveat: string } {
  const a = new Set(laneA), b = new Set(laneB);
  let overlap = 0;
  for (const item of a) if (b.has(item)) overlap++;
  const observed = new Set([...a, ...b]).size;
  if (overlap === 0) {
    return { estimatedTotal: Infinity, observed, coverage: 0, caveat: "No overlap between lanes: the estimator is undefined and the unseen population is probably large." };
  }
  // Chapman-corrected estimator, better behaved at small sample sizes.
  const estimatedTotal = Math.round(((a.size + 1) * (b.size + 1)) / (overlap + 1) - 1);
  return {
    estimatedTotal,
    observed,
    coverage: estimatedTotal === 0 ? 1 : Math.min(1, observed / estimatedTotal),
    caveat: "Assumes independent detectors. Discovery lanes share sources and vocabulary, so treat this as an optimistic lower bound on what is missing, not a coverage guarantee.",
  };
}
