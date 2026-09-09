/**
 * score.ts — the gate that must exist before a real model runs.
 *
 * Scores an extraction run against a hand-labelled golden set, PER FIELD.
 * A single aggregate accuracy number hides the failure that matters: a model
 * can score 90% overall while being wrong about work authorization every time.
 *
 * Two distinct error classes, weighted differently:
 *   FABRICATION  said something the posting does not say. Worst case: a student
 *                applies believing they are eligible. Weighted heaviest.
 *   OMISSION     said "Unknown" when the posting states a value. Costs coverage,
 *                not trust. Recoverable by an officer reading the source.
 */
import type { ExtractedField } from "../evidence";
import { bindExtraction, normalize } from "../evidence";

export interface GoldenCase {
  id: string;
  employer: string;
  title: string;
  rawText: string;
  /** Hand-labelled truth. Omit a field to mean "posting does not state it". */
  expected: Record<string, { value: string; quoteContains?: string }>;
}

export type FieldOutcome = "correct" | "fabricated" | "omitted" | "wrong_value" | "unbound";

export interface FieldResult {
  caseId: string; field: string; outcome: FieldOutcome;
  expected: string | null; got: string; detail?: string;
}

export interface FieldScore {
  field: string; n: number;
  correct: number; fabricated: number; omitted: number; wrongValue: number; unbound: number;
  /** Of the values it asserted, how many were right. The number that matters most. */
  precision: number;
  /** Of the values the postings actually stated, how many it found. */
  recall: number;
}

export interface EvalReport {
  model: string; promptVersion: string; cases: number;
  results: FieldResult[]; byField: FieldScore[];
  overall: { precision: number; recall: number; fabrications: number; bindingFailures: number; decisionFlips: number; decisionFlipRate: number };
  flips: DecisionFlip[];
  gate: { passed: boolean; failures: string[] };
}

/** Words whose presence on only one side means the two values disagree. */
const NEGATIONS = /\b(no|not|never|without|excluded|ineligible|prohibited|unavailable|none)\b/;

/**
 * Loose value comparison for scoring. Casing, punctuation and filler must not
 * fail a match, but three things are strict:
 *   - numbers must agree ("GPA 3.0" != "GPA 3.5")
 *   - negation must agree ("sponsorship available" != "no sponsorship")
 *   - "Unknown" matches only "Unknown"
 */
export function valuesMatch(expected: string, got: string): boolean {
  const clean = (s: string) => normalize(s).toLowerCase()
    .replace(/[$,%()]/g, "").replace(/\b(a|an|the|is|are|of|for|to|in|and|or|per|required|stated|provided)\b/g, "")
    .replace(/[^a-z0-9. -]/g, "").replace(/\s+/g, " ").trim();
  const e = clean(expected), g = clean(got);
  if (!e || !g) return e === g;
  if (e === g) return true;

  // Negation asymmetry is a disagreement, never a near-miss.
  if (NEGATIONS.test(expected.toLowerCase()) !== NEGATIONS.test(got.toLowerCase())) return false;

  // Numbers present on both sides must be identical.
  const nums = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []).sort().join(",");
  const [ne, ng] = [nums(e), nums(g)];
  if (ne && ng && ne !== ng) return false;

  if (e.includes(g) || g.includes(e)) return true;

  // Same fact, different phrasing: "3.0 cumulative" vs "gpa 3.0". Require half
  // the shorter side's tokens to be shared, with numbers already agreeing.
  const te = new Set(e.split(" ").filter((t) => t.length > 1));
  const tg = new Set(g.split(" ").filter((t) => t.length > 1));
  if (te.size === 0 || tg.size === 0) return false;
  const shared = [...te].filter((t) => tg.has(t)).length;
  return shared / Math.min(te.size, tg.size) >= 0.5;
}

export function scoreCase(
  golden: GoldenCase,
  produced: Record<string, ExtractedField>,
  fieldNames: string[],
): FieldResult[] {
  const binding = bindExtraction(produced as never, golden.rawText);
  return fieldNames.map((field): FieldResult => {
    const expected = golden.expected[field];
    const got = produced[field];
    const gotValue = got?.value?.trim() ?? "Unknown";
    const saidSomething = gotValue !== "" && gotValue !== "Unknown";
    const bound = binding.fields[field];

    if (saidSomething && bound && !bound.ok) {
      return { caseId: golden.id, field, outcome: "unbound", expected: expected?.value ?? null, got: gotValue, detail: bound.reason };
    }
    if (!expected) {
      return saidSomething
        ? { caseId: golden.id, field, outcome: "fabricated", expected: null, got: gotValue, detail: "posting does not state this" }
        : { caseId: golden.id, field, outcome: "correct", expected: null, got: gotValue };
    }
    if (!saidSomething) {
      return { caseId: golden.id, field, outcome: "omitted", expected: expected.value, got: "Unknown" };
    }
    if (!valuesMatch(expected.value, gotValue)) {
      return { caseId: golden.id, field, outcome: "wrong_value", expected: expected.value, got: gotValue };
    }
    if (expected.quoteContains && !normalize(got.quote ?? "").toLowerCase().includes(normalize(expected.quoteContains).toLowerCase())) {
      return { caseId: golden.id, field, outcome: "wrong_value", expected: expected.value, got: gotValue, detail: "value right, quote points at the wrong span" };
    }
    return { caseId: golden.id, field, outcome: "correct", expected: expected.value, got: gotValue };
  });
}

/**
 * Decision-flip error rate.
 *
 * From the architecture review: "A field extraction error matters differently
 * depending on whether it changes the decision. Misreading compensation by $1 is
 * not equivalent to incorrectly deciding that an MS student is ineligible."
 *
 * A flip is an error that would change what a student DOES:
 *   - eligible -> looks ineligible  (worst: suppresses a valid application)
 *   - ineligible -> looks eligible  (wastes weeks of effort)
 *   - a real deadline lost or invented (missed window, or wasted urgency)
 *
 * Everything else -- pay off by a dollar, a location phrased differently -- is a
 * quality defect, not a decision defect. Both are tracked; only flips gate.
 */
const DECISION_FIELDS = new Set([
  "masters_eligibility", "work_authorization", "enrollment_rule",
  "return_rule", "gpa_requirement", "deadline", "graduation_window", "degree_fields",
]);

const DISQUALIFYING = /\b(not eligible|ineligible|undergraduate only|phd only|doctoral only|does not|no sponsorship|citizens? only|permanent residents? only|must be a resident|only students)\b/i;

export type FlipKind = "eligible_to_ineligible" | "ineligible_to_eligible" | "deadline_lost" | "deadline_invented";
export interface DecisionFlip { caseId: string; field: string; kind: FlipKind; expected: string | null; got: string }

export function detectFlips(results: FieldResult[]): DecisionFlip[] {
  const flips: DecisionFlip[] = [];
  for (const r of results) {
    if (!DECISION_FIELDS.has(r.field)) continue;
    if (r.outcome === "correct") continue;

    // Any error on a decision-bearing field changes what a student does. Trying
    // to regex-detect "is this restrictive?" proved fragile: "US citizens or
    // permanent residents" is a hard restriction with no "only" in it. So every
    // error here counts, and the pattern below only labels the DIRECTION.
    const expected = r.expected ?? "";
    const got = r.got === "Unknown" ? "" : r.got;

    if (r.field === "deadline") {
      const kind: FlipKind = r.outcome === "fabricated" ? "deadline_invented" : "deadline_lost";
      flips.push({ caseId: r.caseId, field: r.field, kind, expected: r.expected, got: r.got });
      continue;
    }

    // Losing or softening a stated requirement makes a role look MORE open than
    // it is, which wastes an application. Inventing or hardening one makes it
    // look CLOSED, which suppresses a valid application -- the worse direction.
    let kind: FlipKind;
    if (r.outcome === "omitted") kind = "ineligible_to_eligible";
    else if (r.outcome === "fabricated") kind = DISQUALIFYING.test(got) ? "eligible_to_ineligible" : "ineligible_to_eligible";
    else kind = DISQUALIFYING.test(got) && !DISQUALIFYING.test(expected) ? "eligible_to_ineligible" : "ineligible_to_eligible";
    flips.push({ caseId: r.caseId, field: r.field, kind, expected: r.expected, got: r.got });
  }
  return flips;
}

export interface GateConfig {
  /** Fields where a mistake is most costly to a student. */
  criticalFields: string[];
  minCriticalPrecision: number;
  minOverallPrecision: number;
  minOverallRecall: number;
  maxFabrications: number;
  /** Errors that would change what a student does. Zero tolerance on the worst direction. */
  maxDecisionFlips: number;
}

export const DEFAULT_GATE: GateConfig = {
  criticalFields: ["masters_eligibility", "work_authorization", "gpa_requirement", "enrollment_rule", "return_rule", "deadline"],
  minCriticalPrecision: 0.95,
  minOverallPrecision: 0.90,
  minOverallRecall: 0.70,   // recall can be lower: an omission is an officer's job, a fabrication is a student's problem
  maxFabrications: 0,
  maxDecisionFlips: 0,
};

export function aggregate(
  results: FieldResult[],
  fieldNames: string[],
  meta: { model: string; promptVersion: string; cases: number },
  gate: GateConfig = DEFAULT_GATE,
): EvalReport {
  const byField: FieldScore[] = fieldNames.map((field) => {
    const rows = results.filter((r) => r.field === field);
    const correct = rows.filter((r) => r.outcome === "correct").length;
    const fabricated = rows.filter((r) => r.outcome === "fabricated").length;
    const omitted = rows.filter((r) => r.outcome === "omitted").length;
    const wrongValue = rows.filter((r) => r.outcome === "wrong_value").length;
    const unbound = rows.filter((r) => r.outcome === "unbound").length;
    const asserted = rows.filter((r) => r.got !== "Unknown").length;
    const correctAsserted = rows.filter((r) => r.outcome === "correct" && r.expected !== null).length;
    const stated = rows.filter((r) => r.expected !== null).length;
    return {
      field, n: rows.length, correct, fabricated, omitted, wrongValue, unbound,
      precision: asserted === 0 ? 1 : correctAsserted / asserted,
      recall: stated === 0 ? 1 : correctAsserted / stated,
    };
  });

  const fabrications = results.filter((r) => r.outcome === "fabricated").length;
  const bindingFailures = results.filter((r) => r.outcome === "unbound").length;
  const assertedAll = results.filter((r) => r.got !== "Unknown").length;
  const correctAssertedAll = results.filter((r) => r.outcome === "correct" && r.expected !== null).length;
  const statedAll = results.filter((r) => r.expected !== null).length;
  const flips = detectFlips(results);
  const decisionRows = results.filter((r) => DECISION_FIELDS.has(r.field)).length;
  const overall = {
    precision: assertedAll === 0 ? 1 : correctAssertedAll / assertedAll,
    recall: statedAll === 0 ? 1 : correctAssertedAll / statedAll,
    fabrications, bindingFailures,
    decisionFlips: flips.length,
    decisionFlipRate: decisionRows === 0 ? 0 : flips.length / decisionRows,
  };

  const failures: string[] = [];
  if (overall.precision < gate.minOverallPrecision) failures.push(`overall precision ${overall.precision.toFixed(3)} < ${gate.minOverallPrecision}`);
  if (overall.recall < gate.minOverallRecall) failures.push(`overall recall ${overall.recall.toFixed(3)} < ${gate.minOverallRecall}`);
  if (fabrications > gate.maxFabrications) failures.push(`${fabrications} fabrication(s), max ${gate.maxFabrications}`);
  if (bindingFailures > 0) failures.push(`${bindingFailures} unbound quote(s) reached scoring`);
  if (flips.length > gate.maxDecisionFlips) {
    const worst = flips.filter((f) => f.kind === "eligible_to_ineligible");
    failures.push(`${flips.length} decision flip(s), max ${gate.maxDecisionFlips}${worst.length ? ` — ${worst.length} would wrongly mark a student ineligible` : ""}: ${flips.slice(0, 3).map((f) => `${f.caseId}/${f.field} (${f.kind})`).join("; ")}`);
  }
  for (const field of gate.criticalFields) {
    const score = byField.find((f) => f.field === field);
    if (score && score.n > 0 && score.precision < gate.minCriticalPrecision) {
      failures.push(`critical field "${field}" precision ${score.precision.toFixed(3)} < ${gate.minCriticalPrecision}`);
    }
  }

  return { ...meta, results, byField, overall, flips, gate: { passed: failures.length === 0, failures } };
}

export function formatReport(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`model=${report.model} prompt=${report.promptVersion} cases=${report.cases}`);
  lines.push("");
  lines.push("field                        n  corr  fab  omit  wrong  unb   prec  recall");
  for (const f of report.byField.filter((f) => f.n > 0).sort((a, b) => a.precision - b.precision)) {
    lines.push(
      `${f.field.padEnd(26)} ${String(f.n).padStart(2)}  ${String(f.correct).padStart(4)}  ${String(f.fabricated).padStart(3)}  ${String(f.omitted).padStart(4)}  ${String(f.wrongValue).padStart(5)}  ${String(f.unbound).padStart(3)}  ${f.precision.toFixed(2)}   ${f.recall.toFixed(2)}`,
    );
  }
  lines.push("");
  lines.push(`overall precision ${report.overall.precision.toFixed(3)} | recall ${report.overall.recall.toFixed(3)} | fabrications ${report.overall.fabrications} | unbound ${report.overall.bindingFailures}`);
  lines.push(`decision flips ${report.overall.decisionFlips} (rate ${(report.overall.decisionFlipRate * 100).toFixed(1)}% of decision-bearing fields)`);
  for (const flip of report.flips.slice(0, 5)) lines.push(`  flip: ${flip.caseId} ${flip.field} — ${flip.kind}`);
  lines.push(report.gate.passed ? "GATE PASSED" : `GATE FAILED:\n  - ${report.gate.failures.join("\n  - ")}`);
  return lines.join("\n");
}
