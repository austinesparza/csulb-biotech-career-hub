/**
 * classify.ts — deterministic pre-filter and classifier.
 *
 * Runs BEFORE any model call. Two jobs:
 *   1. Drop the ~90% of postings that are irrelevant, at zero cost.
 *   2. Attach lanes, functions, methods, stage and gates to what survives,
 *      so the model has less to decide and the officer has more to check.
 *
 * Design rule: reject obvious noise, but keep ambiguous scientific roles for
 * officer review. Public submissions are a supplement, not a recall control.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface Taxonomy {
  version: number;
  lanes: LaneDef[];
  biological_context: string[];
  functions: FunctionDef[];
  methods: Record<string, string[]>;
  opportunity_types: { in_scope: TypeDef[]; adjacent: TypeDef[] };
  graduate_stage: StageDef[];
  structural_gates: GateDef[];
  personal_gates: Record<string, string[]>;
  exclude_titles: string[];
}
interface LaneDef { id: string; label: string; core: string[]; supporting?: string[]; weak?: string[]; requires_context?: boolean; }
interface FunctionDef { id: string; label: string; terms: string[]; review_required?: boolean; }
interface TypeDef { id: string; terms: string[]; reason_template?: string; }
interface StageDef { id: string; label: string; patterns: string[]; eligible: boolean; }
interface GateDef { id: string; patterns: string[]; bucket: string; }

const TAXONOMY_PATH = path.join(process.cwd(), "src/lib/pipeline/taxonomy/lanes.yaml");

export function loadTaxonomy(file = TAXONOMY_PATH): Taxonomy {
  return YAML.parse(fs.readFileSync(file, "utf8"));
}

/** Lowercase, collapse whitespace, normalize punctuation that breaks term matching. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ");
}

/** Word-boundary containment. Prevents "als" matching "also" and "io" matching "biology". */
function hasTerm(haystack: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \b fails next to non-word chars like "r/bioconductor", so anchor on separators.
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(haystack);
}

function anyTerm(haystack: string, terms: string[] = []): string[] {
  return terms.filter((t) => hasTerm(haystack, t));
}

export interface Posting {
  title: string;
  employer: string;
  body: string;
  location?: string;
  url?: string;
}

export interface Classification {
  keep: boolean;
  dropReason?: string;
  lanes: { id: string; label: string; score: number; hits: string[]; provisional?: boolean }[];
  functions: { id: string; label: string; reviewRequired: boolean }[];
  methods: { wet_lab: string[]; dry_lab: string[]; stats: string[] };
  opportunityType: { id: string; scope: "in_scope" | "adjacent"; reason?: string } | null;
  stage: { id: string; label: string; eligible: boolean };
  structuralGates: { id: string; bucket: string }[];
  personalGates: string[];
  /** True when no lane had a core term: every lane rests on corroborating supporting hits. Review more carefully. */
  corroboratedOnly?: boolean;
  suggestedBucket: "graduate" | "special" | "adjacent" | "excluded" | "needs_review";
  score: number;
}

export function classify(posting: Posting, tax: Taxonomy): Classification {
  const title = normalize(posting.title);
  const body = normalize(posting.body);
  const all = `${title} ${normalize(posting.employer)} ${body}`;

  const empty: Classification = {
    keep: false, lanes: [], functions: [], methods: { wet_lab: [], dry_lab: [], stats: [] },
    opportunityType: null, stage: { id: "unclear", label: "Not stated", eligible: true },
    structuralGates: [], personalGates: [], suggestedBucket: "excluded", score: 0,
  };

  // --- 1. Title-level negative filter (cheapest possible rejection) ---
  const excluded = tax.exclude_titles.find((t) => hasTerm(title, t));
  if (excluded) return { ...empty, dropReason: `title matches excluded term "${excluded}"` };
  // Everything below computes the full analysis even when we end up dropping,
  // so a drop is explainable rather than a silent disappearance.

  // --- 2. Lanes, with a context gate for the false-positive-prone ones ---
  const hasBioContext = tax.biological_context.some((t) => all.includes(t));
  const lanes: Classification["lanes"] = [];
  for (const lane of tax.lanes) {
    const core = anyTerm(all, lane.core);
    const supporting = anyTerm(all, lane.supporting);
    if (core.length === 0 && supporting.length === 0) continue;
    if (lane.requires_context && !hasBioContext) continue; // ML at a bank: dropped here
    // Weak terms alone never qualify a lane; they only add a little weight.
    const weak = anyTerm(all, lane.weak);
    const titleBoost = lane.core.some((t) => hasTerm(title, t)) ? 3 : 0;
    const score = core.length * 3 + supporting.length * 1.5 + weak.length * 0.25 + titleBoost;
    const provisional = core.length === 0 && supporting.length < 2;
    lanes.push({ id: lane.id, label: lane.label, score: Number(score.toFixed(2)), hits: [...core, ...supporting].slice(0, 8), provisional });
  }

  // A single supporting hit is not a lane on its own -- that rule keeps generic
  // roles out. But TWO different lanes each holding a supporting hit, inside a
  // biological context, is corroboration rather than noise. Found by the
  // must-not-miss set: "variant annotation" + "CLIA" was being dropped entirely.
  const solid = lanes.filter((l) => !l.provisional);
  const provisionalLanes = lanes.filter((l) => l.provisional);
  const corroborated = solid.length === 0 && provisionalLanes.length >= 2 && hasBioContext;
  const keptLanes = solid.length > 0
    ? [...solid, ...provisionalLanes]
    : corroborated ? provisionalLanes : [];
  lanes.length = 0;
  lanes.push(...keptLanes);
  lanes.sort((a, b) => b.score - a.score);

  // --- 3. Functions ---
  const functions = tax.functions
    .filter((f) => f.terms.some((t) => hasTerm(all, t)))
    .map((f) => ({ id: f.id, label: f.label, reviewRequired: Boolean(f.review_required) }));

  // --- 4. Methods (resume-relevant, and useful for student-side search) ---
  const methods = {
    wet_lab: anyTerm(all, tax.methods.wet_lab),
    dry_lab: anyTerm(all, tax.methods.dry_lab),
    stats: anyTerm(all, tax.methods.stats),
  };

  // --- 5. Opportunity type. Adjacent wins over in-scope when both appear,
  //     because "Spring Co-op" containing the word "internship" is still a co-op.
  let opportunityType: Classification["opportunityType"] = null;
  for (const t of tax.opportunity_types.adjacent) {
    const hit = t.terms.find((term) => hasTerm(all, term));
    if (hit) {
      opportunityType = { id: t.id, scope: "adjacent", reason: (t.reason_template ?? "{term}").replace("{term}", hit) };
      break;
    }
  }
  if (!opportunityType) {
    for (const t of tax.opportunity_types.in_scope) {
      if (t.terms.some((term) => hasTerm(all, term))) { opportunityType = { id: t.id, scope: "in_scope" }; break; }
    }
  }

  // --- 6. Graduate stage. First match wins; taxonomy order is most-specific-first. ---
  let stage = { id: "unclear", label: "Not stated", eligible: true };
  for (const s of tax.graduate_stage) {
    if (s.patterns.some((p) => new RegExp(p, "i").test(all))) {
      stage = { id: s.id, label: s.label, eligible: s.eligible };
      break;
    }
  }

  // --- 7. Structural gates vs personal gates. A posting can carry more than
  //     one structural restriction, and officers need to see all of them. ---
  const structuralGates: Classification["structuralGates"] = tax.structural_gates
    .filter((gate) => gate.patterns.some((pattern) => new RegExp(pattern, "i").test(all)))
    .map((gate) => ({ id: gate.id, bucket: gate.bucket }));
  const personalGates = Object.entries(tax.personal_gates)
    .filter(([, patterns]) => patterns.some((p) => new RegExp(p, "i").test(all)))
    .map(([name]) => name);

  // --- 8. Keep/drop and bucket suggestion (a SUGGESTION; officers decide) ---
  const corroboratedOnly = lanes.length > 0 && lanes.every((l) => l.provisional);
  const analysis = { lanes, functions, methods, opportunityType, stage, structuralGates, personalGates, corroboratedOnly };
  const hasNamedMethod = methods.wet_lab.length + methods.dry_lab.length + methods.stats.length > 0;
  const relevant = lanes.length > 0 || (hasNamedMethod && hasBioContext);
  const isInternship = opportunityType !== null;
  if (!relevant) return { ...empty, ...analysis, dropReason: "no scientific lane matched" };
  if (!isInternship && functions.length === 0) {
    return { ...empty, ...analysis, dropReason: "scientific lanes matched but no internship or research-function signal" };
  }

  let suggestedBucket: Classification["suggestedBucket"] = stage.id === "unclear" ? "needs_review" : "graduate";
  if (stage.id === "undergrad_only") suggestedBucket = "excluded";
  else if (stage.id === "phd_only") suggestedBucket = "special";
  else if (structuralGates.length > 0) suggestedBucket = structuralGates[0].bucket as Classification["suggestedBucket"];
  else if (opportunityType?.scope === "adjacent" || stage.id === "postbac_stage") suggestedBucket = "adjacent";

  const score = Number((
    lanes.reduce((sum, l) => sum + l.score, 0) +
    functions.length * 2 +
    (opportunityType?.scope === "in_scope" ? 4 : 0) +
    (stage.eligible ? 3 : -6) +
    Math.min(methods.dry_lab.length + methods.wet_lab.length, 6) * 0.5
  ).toFixed(2));

  return { keep: true, lanes, functions, methods, opportunityType, stage, structuralGates, personalGates, corroboratedOnly, suggestedBucket, score };
}

/**
 * Query strings for connectors that accept a search parameter (USAJOBS, Ashby,
 * some Greenhouse boards). Kept short: long boolean strings behave badly across
 * providers and silently return nothing.
 */
export function buildQueries(tax: Taxonomy): { lane: string; queries: string[] }[] {
  const seasons = ["intern", "internship", "summer 2027"];
  return tax.lanes.map((lane) => ({
    lane: lane.id,
    queries: lane.core.slice(0, 4).flatMap((core) => seasons.slice(0, 2).map((s) => `${core} ${s}`)),
  }));
}
