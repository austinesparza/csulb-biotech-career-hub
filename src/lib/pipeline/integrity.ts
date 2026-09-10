/**
 * integrity.ts — detect when something rewrote the payload in transit.
 *
 * WHY: evidence binding requires quotes to be literal substrings of the stored
 * raw_text. Anything that rewrites the text on the wire -- a compression proxy
 * (Headroom), a gateway's prompt-compression feature (OmniRoute), an
 * output-style injection (Caveman), or an over-eager summarizer -- breaks that
 * silently. The model quotes what it was SHOWN; binding checks against what we
 * STORED; every field fails.
 *
 * Without this module the symptom is indistinguishable from "the model got
 * worse", and the natural response is to blame or swap the model. That wastes
 * days and fixes nothing.
 *
 * Two detectors, cheap enough to always run:
 *   1. ACTIVE  — a sentinel echoed back through the model. If it comes back
 *                changed, something rewrote the request.
 *   2. PASSIVE — a binding-failure pattern across postings. Infrastructure
 *                failures are near-total and simultaneous; model failures are
 *                partial and scattered.
 */

/** Deliberately compression-hostile: filler words a compressor strips, exact
 *  spacing, and a token no summarizer would consider load-bearing. */
export function makeSentinel(nonce: string): string {
  return `INTEGRITY CHECK ${nonce}: please repeat this entire line back in the field named integrity_echo, exactly as written, including the words a and the and this trailing marker ${nonce}-END`;
}

export interface EchoResult {
  ok: boolean;
  reason?: "missing" | "altered" | "truncated";
  detail?: string;
}

export function checkEcho(sentinel: string, echoed: string | null | undefined): EchoResult {
  if (!echoed || !echoed.trim()) return { ok: false, reason: "missing", detail: "model returned no integrity_echo" };
  const got = echoed.trim();
  if (got === sentinel) return { ok: true };
  if (sentinel.startsWith(got) || got.length < sentinel.length * 0.8) {
    return { ok: false, reason: "truncated", detail: `echo is ${got.length} chars, sentinel is ${sentinel.length}` };
  }
  return { ok: false, reason: "altered", detail: `echo differs from sentinel; something rewrote the payload` };
}

export interface BindingObservation {
  candidateId: string;
  source: string;
  totalFields: number;
  /** Fields where the model asserted a value AND the quote failed to bind. */
  unboundFields: number;
  at: number;
}

export type IntegrityVerdict = "healthy" | "model_quality" | "transit_corruption" | "source_drift";

export interface IntegrityReport {
  verdict: IntegrityVerdict;
  failureRate: number;
  affectedSources: string[];
  sampleSize: number;
  explanation: string;
}

/**
 * Distinguish three causes of a binding-failure spike. The shape of the failure
 * tells you which one it is, and they need opposite responses.
 */
export function diagnose(observations: BindingObservation[], opts: { minSample?: number } = {}): IntegrityReport {
  const minSample = opts.minSample ?? 5;
  if (observations.length < minSample) {
    return { verdict: "healthy", failureRate: 0, affectedSources: [], sampleSize: observations.length, explanation: `only ${observations.length} observations; need ${minSample} before diagnosing` };
  }

  const asserted = observations.reduce((sum, o) => sum + o.totalFields, 0);
  const unbound = observations.reduce((sum, o) => sum + o.unboundFields, 0);
  const failureRate = asserted === 0 ? 0 : unbound / asserted;

  const bySource = new Map<string, { total: number; unbound: number }>();
  for (const o of observations) {
    const entry = bySource.get(o.source) ?? { total: 0, unbound: 0 };
    entry.total += o.totalFields;
    entry.unbound += o.unboundFields;
    bySource.set(o.source, entry);
  }
  const sourceRates = [...bySource.entries()].map(([source, e]) => ({ source, rate: e.total === 0 ? 0 : e.unbound / e.total }));
  const badSources = sourceRates.filter((s) => s.rate > 0.5).map((s) => s.source);

  if (failureRate < 0.15) {
    return { verdict: "healthy", failureRate, affectedSources: [], sampleSize: observations.length, explanation: "binding failures within normal range" };
  }

  // Near-total failure across EVERY source at once is not a model getting worse
  // and not a page redesign. Something is rewriting text between us and the model.
  const allSourcesAffected = badSources.length === bySource.size && bySource.size >= 2;
  if (failureRate > 0.8 && allSourcesAffected) {
    return {
      verdict: "transit_corruption",
      failureRate, affectedSources: badSources, sampleSize: observations.length,
      explanation: "Near-total binding failure across every source simultaneously. This is almost certainly something rewriting the payload in transit: a compression proxy (Headroom), a gateway prompt-compression setting (OmniRoute), or an injected output style (Caveman). Do NOT swap models. Disable compression for the extraction worker and re-run one posting.",
    };
  }

  // One source failing while others are fine is that source's page changing.
  if (badSources.length > 0 && badSources.length < bySource.size) {
    return {
      verdict: "source_drift",
      failureRate, affectedSources: badSources, sampleSize: observations.length,
      explanation: `Binding fails for ${badSources.join(", ")} while other sources are healthy. Likely a page or endpoint change at those sources. Check the parser and the stored raw_text.`,
    };
  }

  return {
    verdict: "model_quality",
    failureRate, affectedSources: badSources, sampleSize: observations.length,
    explanation: "Elevated but partial and scattered binding failures. Consistent with a model or prompt regression. Run the golden set before changing anything else.",
  };
}

/** The field to append to the extraction schema when the guard is enabled. */
export const INTEGRITY_FIELD = "integrity_echo";

export function withSentinel(userPrompt: string, nonce: string): { prompt: string; sentinel: string } {
  const sentinel = makeSentinel(nonce);
  // Placed BEFORE the posting so a truncating proxy cuts it too, and outside
  // the posting fence so it is never confused with untrusted content.
  return { prompt: `${sentinel}\n\n${userPrompt}`, sentinel };
}
