export const CLASSIFICATION_AXES = [
  'scientific_lanes',
  'job_functions',
  'methods',
] as const;

export type ClassificationAxis = (typeof CLASSIFICATION_AXES)[number];

export interface ClassificationTagSnapshot {
  scientific_lanes?: unknown;
  job_functions?: unknown;
  methods?: unknown;
}

export interface ClassificationFeedbackRow {
  id: string;
  opportunity_id: string;
  proposal_source: 'deterministic_taxonomy' | 'legacy_draft';
  taxonomy_version: number | null;
  proposed_tags: ClassificationTagSnapshot;
  final_tags: ClassificationTagSnapshot;
  created_at: string;
}

export interface LabelMetrics {
  label: string;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  finalSupport: number;
}

export interface AxisMetrics {
  axis: ClassificationAxis;
  reviewed: number;
  exactMatches: number;
  exactMatchRate: number;
  proposedCoverage: number;
  addedTags: number;
  removedTags: number;
  microPrecision: number | null;
  microRecall: number | null;
  microF1: number | null;
  macroF1: number | null;
  labels: LabelMetrics[];
}

export interface ClassificationLearningReport {
  reviewedSnapshots: number;
  evaluableSnapshots: number;
  taxonomyVersions: number[];
  readyForShadowSuggestions: boolean;
  readinessReason: string;
  axes: AxisMetrics[];
}

const MIN_EVALUABLE_SNAPSHOTS = 30;
const MIN_FINAL_SUPPORT_PER_LABEL = 8;

function cleanTags(snapshot: ClassificationTagSnapshot, axis: ClassificationAxis): Set<string> {
  const value = snapshot?.[axis];
  if (!Array.isArray(value)) return new Set();
  return new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean));
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function f1FromCounts(truePositive: number, falsePositive: number, falseNegative: number): number | null {
  const denominator = (2 * truePositive) + falsePositive + falseNegative;
  return denominator === 0 ? null : (2 * truePositive) / denominator;
}

function evaluateAxis(rows: ClassificationFeedbackRow[], axis: ClassificationAxis): AxisMetrics {
  const counts = new Map<string, { tp: number; fp: number; fn: number }>();
  let exactMatches = 0;
  let covered = 0;
  let addedTags = 0;
  let removedTags = 0;

  for (const row of rows) {
    const proposed = cleanTags(row.proposed_tags, axis);
    const final = cleanTags(row.final_tags, axis);
    if (proposed.size > 0) covered += 1;
    const labels = new Set([...proposed, ...final]);
    let exact = proposed.size === final.size;

    for (const label of labels) {
      const proposedLabel = proposed.has(label);
      const finalLabel = final.has(label);
      const current = counts.get(label) ?? { tp: 0, fp: 0, fn: 0 };
      if (proposedLabel && finalLabel) current.tp += 1;
      else if (proposedLabel) {
        current.fp += 1;
        removedTags += 1;
        exact = false;
      } else {
        current.fn += 1;
        addedTags += 1;
        exact = false;
      }
      counts.set(label, current);
    }
    if (exact) exactMatches += 1;
  }

  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  const labels = [...counts.entries()].map(([label, count]): LabelMetrics => {
    totalTp += count.tp;
    totalFp += count.fp;
    totalFn += count.fn;
    const precision = ratio(count.tp, count.tp + count.fp);
    const recall = ratio(count.tp, count.tp + count.fn);
    return {
      label,
      truePositive: count.tp,
      falsePositive: count.fp,
      falseNegative: count.fn,
      precision,
      recall,
      f1: f1FromCounts(count.tp, count.fp, count.fn),
      finalSupport: count.tp + count.fn,
    };
  }).sort((a, b) => b.finalSupport - a.finalSupport || a.label.localeCompare(b.label));

  const microPrecision = ratio(totalTp, totalTp + totalFp);
  const microRecall = ratio(totalTp, totalTp + totalFn);
  const supportedF1 = labels
    .filter((label) => label.finalSupport >= MIN_FINAL_SUPPORT_PER_LABEL && label.f1 !== null)
    .map((label) => label.f1 as number);

  return {
    axis,
    reviewed: rows.length,
    exactMatches,
    exactMatchRate: rows.length === 0 ? 1 : exactMatches / rows.length,
    proposedCoverage: rows.length === 0 ? 0 : covered / rows.length,
    addedTags,
    removedTags,
    microPrecision,
    microRecall,
    microF1: f1FromCounts(totalTp, totalFp, totalFn),
    macroF1: supportedF1.length === 0
      ? null
      : supportedF1.reduce((sum, value) => sum + value, 0) / supportedF1.length,
    labels,
  };
}

/**
 * Evaluate the deterministic taxonomy against officer-final multi-label tags.
 * Legacy drafts remain in the audit history but are excluded from classifier
 * metrics because they are not a reproducible machine proposal.
 */
export function evaluateClassificationFeedback(
  feedback: ClassificationFeedbackRow[],
): ClassificationLearningReport {
  const evaluable = feedback.filter((row) => (
    row.proposal_source === 'deterministic_taxonomy'
    && Number.isInteger(row.taxonomy_version)
  ));
  const taxonomyVersions = [...new Set(evaluable
    .map((row) => row.taxonomy_version)
    .filter((version): version is number => version !== null))]
    .sort((a, b) => a - b);
  const axes = CLASSIFICATION_AXES.map((axis) => evaluateAxis(evaluable, axis));
  const supportedLabels = axes.flatMap((axis) => axis.labels)
    .filter((label) => label.finalSupport >= MIN_FINAL_SUPPORT_PER_LABEL).length;
  const readyForShadowSuggestions = evaluable.length >= MIN_EVALUABLE_SNAPSHOTS
    && supportedLabels > 0;

  return {
    reviewedSnapshots: feedback.length,
    evaluableSnapshots: evaluable.length,
    taxonomyVersions,
    readyForShadowSuggestions,
    readinessReason: readyForShadowSuggestions
      ? 'Enough reviewed extraction-backed snapshots exist to evaluate shadow-only tag suggestions.'
      : `Keep collecting corrections until there are at least ${MIN_EVALUABLE_SNAPSHOTS} extraction-backed reviews and ${MIN_FINAL_SUPPORT_PER_LABEL} final examples for a label.`,
    axes,
  };
}
