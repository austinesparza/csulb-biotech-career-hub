/**
 * retrieval.ts — hybrid lexical + semantic retrieval.
 *
 * The architecture review's #2 item, and the largest remaining gap: matching is
 * currently pure lexical taxonomy lookup, which works for phrasings we
 * anticipated and fails silently for ones we did not.
 *
 * WHAT IS VERIFIED HERE: the BM25 implementation, the fusion mathematics, and
 * graceful degradation when embeddings are unavailable. All tested offline.
 *
 * WHAT IS NOT VERIFIED: whether semantic retrieval actually improves recall on
 * THIS corpus. That is corpus-dependent and cannot be established without real
 * embeddings. lib/eval/retrieval-bench.ts exists to answer it once a real
 * embedder is plugged in. Do not assume the answer; the review is explicit that
 * model rankings are corpus-dependent and must be measured locally.
 */

export interface Doc {
  id: string;
  text: string;
  /** Optional pre-computed embedding. Absent means lexical-only for this doc. */
  vector?: number[];
}

export interface ScoredDoc {
  id: string;
  score: number;
  rank: number;
}

/* ---------------------------------------------------------------------------
   Lexical: BM25
   --------------------------------------------------------------------------- */

const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

/** Single letters that carry meaning in this domain. "R" is a programming
 *  language here, not noise, and it appears in a large share of postings. */
const MEANINGFUL_SINGLE_CHARS = new Set(["r", "c"]);

/** Minimal English stemming: enough to unify plural/gerund forms without a dependency. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-/']/g, " ")
    .split(/[\s/]+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 1 || MEANINGFUL_SINGLE_CHARS.has(t))
    .map((t) => t.replace(/(ies)$/, "y").replace(/(sses|shes|ches)$/, "s").replace(/([^s])s$/, "$1").replace(/(ing|ed)$/, ""));
}

export class BM25 {
  private df = new Map<string, number>();
  private docs: { id: string; tokens: string[]; length: number }[] = [];
  private avgdl = 0;

  constructor(docs: Doc[], private k1 = DEFAULT_K1, private b = DEFAULT_B) {
    for (const doc of docs) {
      const tokens = tokenize(doc.text);
      this.docs.push({ id: doc.id, tokens, length: tokens.length });
      for (const term of new Set(tokens)) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    this.avgdl = this.docs.length === 0 ? 0 : this.docs.reduce((sum, d) => sum + d.length, 0) / this.docs.length;
  }

  /** Robertson/Sparck-Jones IDF with the +1 smoothing that keeps it non-negative. */
  private idf(term: string): number {
    const n = this.df.get(term) ?? 0;
    const N = this.docs.length;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  }

  search(query: string, limit = 50): ScoredDoc[] {
    const terms = tokenize(query);
    const scored = this.docs.map((doc) => {
      let score = 0;
      for (const term of terms) {
        const f = doc.tokens.filter((t) => t === term).length;
        if (f === 0) continue;
        const norm = f + this.k1 * (1 - this.b + (this.b * doc.length) / (this.avgdl || 1));
        score += this.idf(term) * ((f * (this.k1 + 1)) / norm);
      }
      return { id: doc.id, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }
}

/* ---------------------------------------------------------------------------
   Semantic: pluggable embedder, exactly like the model and store ports
   --------------------------------------------------------------------------- */

export interface Embedder {
  name: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`dimension mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * A similarity floor is not optional. Without it, semantic search returns the
 * ENTIRE corpus ranked, fusion drags every irrelevant document into the result
 * set, and precision collapses -- measured at -33 points on the first run of the
 * retrieval benchmark. The floor is what makes the semantic arm a filter rather
 * than a re-ordering of everything.
 */
export const DEFAULT_MIN_SIMILARITY = 0.25;

export function vectorSearch(queryVector: number[], docs: Doc[], limit = 50, minSimilarity = DEFAULT_MIN_SIMILARITY): ScoredDoc[] {
  return docs
    .filter((d) => d.vector)
    .map((d) => ({ id: d.id, score: cosine(queryVector, d.vector!) }))
    .filter((s) => s.score >= minSimilarity)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

/* ---------------------------------------------------------------------------
   Fusion: Reciprocal Rank Fusion
   --------------------------------------------------------------------------- */

/**
 * RRF combines ranked lists without needing their scores to be comparable,
 * which matters because BM25 scores are unbounded and cosine is [-1,1].
 * Normalising them onto a shared scale requires assumptions RRF avoids.
 *
 *   score(d) = Σ_lists  weight_i / (k + rank_i(d))
 *
 * k dampens the influence of top ranks; 60 is the conventional default.
 */
export function reciprocalRankFusion(
  lists: { name: string; results: ScoredDoc[]; weight?: number }[],
  opts: { k?: number; limit?: number } = {},
): (ScoredDoc & { contributors: string[] })[] {
  const k = opts.k ?? 60;
  const limit = opts.limit ?? 50;
  const totals = new Map<string, { score: number; contributors: string[] }>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    for (const result of list.results) {
      const entry = totals.get(result.id) ?? { score: 0, contributors: [] };
      entry.score += weight / (k + result.rank);
      entry.contributors.push(list.name);
      totals.set(result.id, entry);
    }
  }

  return [...totals.entries()]
    .map(([id, e]) => ({ id, score: e.score, contributors: e.contributors }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ---------------------------------------------------------------------------
   The retriever
   --------------------------------------------------------------------------- */

export interface HybridOptions {
  limit?: number;
  minSimilarity?: number;
  rrfK?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
}

export interface HybridResult {
  results: (ScoredDoc & { contributors: string[] })[];
  mode: "hybrid" | "lexical_only";
  note?: string;
}

export class HybridRetriever {
  private bm25: BM25;
  constructor(private docs: Doc[], private embedder: Embedder | null = null) {
    this.bm25 = new BM25(docs);
  }

  /**
   * Degrades to lexical-only when no embedder is configured or the embedding
   * call fails. Retrieval going quiet is worse than retrieval going lexical.
   */
  async search(query: string, opts: HybridOptions = {}): Promise<HybridResult> {
    const limit = opts.limit ?? 50;
    const lexical = this.bm25.search(query, limit * 2);

    if (!this.embedder) {
      return { results: reciprocalRankFusion([{ name: "lexical", results: lexical }], { k: opts.rrfK, limit }), mode: "lexical_only", note: "no embedder configured" };
    }
    const embedded = this.docs.filter((d) => d.vector).length;
    if (embedded === 0) {
      return { results: reciprocalRankFusion([{ name: "lexical", results: lexical }], { k: opts.rrfK, limit }), mode: "lexical_only", note: "no documents have embeddings yet" };
    }

    let semantic: ScoredDoc[];
    try {
      const [queryVector] = await this.embedder.embed([query]);
      semantic = vectorSearch(queryVector, this.docs, limit * 2, opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY);
    } catch (error) {
      return {
        results: reciprocalRankFusion([{ name: "lexical", results: lexical }], { k: opts.rrfK, limit }),
        mode: "lexical_only",
        note: `embedding failed, fell back to lexical: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      results: reciprocalRankFusion(
        [
          { name: "lexical", results: lexical, weight: opts.lexicalWeight ?? 1 },
          { name: "semantic", results: semantic, weight: opts.semanticWeight ?? 1 },
        ],
        { k: opts.rrfK, limit },
      ),
      mode: "hybrid",
    };
  }
}
