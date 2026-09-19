export const DISCOVERY_FEATURE_SCHEMA_VERSION = 1;

export const DISCOVERY_FEATURE_NAMES = [
  'triage_score',
  'triage_keep',
  'student_bucket',
  'official_route',
  'linkedin_route',
  'employer_search',
  'historical_watch',
  'scientific_lane_search',
  'inverse_result_rank',
  'repeat_observation',
  'employer_identified',
  'snippet_available',
] as const;

export type DiscoveryFeatureName = typeof DISCOVERY_FEATURE_NAMES[number];
export type DiscoveryLearningLabel = 'relevant' | 'irrelevant' | 'duplicate' | 'closed' | 'unverifiable';

export interface DiscoveryLearningInput {
  leadId: string;
  label: DiscoveryLearningLabel;
  labeledAt: string;
  route: 'official_feed' | 'employer_page' | 'web_search' | 'linkedin_lead';
  resolution: 'official_source_found' | 'linkedin_only' | 'aggregator_only' | 'dead_link' | 'unresolved';
  occurrenceCount: number;
  employerHint: string | null;
  latestSnippet: string | null;
  lane: string | null;
  observationMetadata: Record<string, unknown>;
  labelSource?: 'officer' | 'promotion' | 'missed_role';
  featureSnapshot?: Record<string, unknown> | null;
  queryFamilySnapshot?: string | null;
}

export interface DiscoveryFeatureVector {
  leadId: string;
  values: number[];
  named: Record<DiscoveryFeatureName, number>;
  queryFamily: string;
}

export interface LogisticModel {
  algorithm: 'logistic_regression_v1';
  featureSchemaVersion: number;
  featureNames: readonly DiscoveryFeatureName[];
  means: number[];
  scales: number[];
  coefficients: number[];
  intercept: number;
}

export interface DiscoveryEvaluation {
  trainingRows: number;
  holdoutRows: number;
  positives: number;
  negatives: number;
  holdoutPositives: number;
  holdoutNegatives: number;
  prevalence: number;
  logLoss: number | null;
  baselineLogLoss: number | null;
  brierScore: number | null;
  baselineBrierScore: number | null;
  rocAuc: number | null;
  precisionAtK: number | null;
  k: number;
  passesInfluenceGate: boolean;
  gateReasons: string[];
}

export type DiscoveryTrainingResult =
  | {
    status: 'insufficient_data';
    usableRows: number;
    positives: number;
    negatives: number;
    minimumRows: number;
    minimumPerClass: number;
  }
  | {
    status: 'trained';
    model: LogisticModel;
    evaluation: DiscoveryEvaluation;
    vectors: Array<{ leadId: string; probability: number; named: Record<DiscoveryFeatureName, number> }>;
  };

interface TriageMetadata {
  score: number | null;
  keep: boolean | null;
  suggestedBucket: string | null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function triageMetadata(metadata: Record<string, unknown>): TriageMetadata {
  const triage = objectValue(metadata.snippetTriage);
  return {
    score: typeof triage?.score === 'number' && Number.isFinite(triage.score) ? triage.score : null,
    keep: typeof triage?.keep === 'boolean' ? triage.keep : null,
    suggestedBucket: typeof triage?.suggestedBucket === 'string' ? triage.suggestedBucket : null,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function queryFamilyForLead(input: DiscoveryLearningInput): string {
  if (input.queryFamilySnapshot?.trim()) return input.queryFamilySnapshot.trim().slice(0, 240);
  const basis = metadataText(input.observationMetadata, 'discoveryBasis') ?? 'unknown_basis';
  const queryRoute = metadataText(input.observationMetadata, 'queryRoute') ?? input.route;
  const lane = input.lane?.trim() || 'all_lanes';
  return `${basis}:${queryRoute}:${lane}`.slice(0, 240);
}

/**
 * Converts private lead metadata into a small, auditable feature vector.
 * It deliberately excludes names, protected traits, school identity, and any
 * officer-authored free text. The model predicts officer relevance only.
 */
export function featuresForDiscoveryLead(input: DiscoveryLearningInput): DiscoveryFeatureVector {
  if (input.featureSnapshot) {
    const named = Object.fromEntries(DISCOVERY_FEATURE_NAMES.map((name) => {
      const value = input.featureSnapshot?.[name];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`invalid frozen discovery feature: ${name}`);
      }
      return [name, value];
    })) as Record<DiscoveryFeatureName, number>;
    return {
      leadId: input.leadId,
      values: DISCOVERY_FEATURE_NAMES.map((name) => named[name]),
      named,
      queryFamily: queryFamilyForLead(input),
    };
  }
  const triage = triageMetadata(input.observationMetadata);
  const basis = metadataText(input.observationMetadata, 'discoveryBasis');
  const rankValue = input.observationMetadata.rank;
  const resultRank = typeof rankValue === 'number' && Number.isInteger(rankValue) && rankValue > 0
    ? rankValue
    : null;
  const studentBucket = triage.suggestedBucket
    ? ['undergraduate', 'graduate', 'needs_review'].includes(triage.suggestedBucket)
    : false;

  const named: Record<DiscoveryFeatureName, number> = {
    triage_score: triage.score === null ? 0 : clamp01(triage.score / 40),
    triage_keep: triage.keep === true ? 1 : 0,
    student_bucket: studentBucket ? 1 : 0,
    official_route: input.route === 'official_feed' || input.route === 'employer_page' ? 1 : 0,
    linkedin_route: input.route === 'linkedin_lead' ? 1 : 0,
    employer_search: basis === 'local_employer_inventory' ? 1 : 0,
    historical_watch: basis === 'historical_role_watch' ? 1 : 0,
    scientific_lane_search: basis === 'scientific_lane_rotation' ? 1 : 0,
    inverse_result_rank: resultRank === null ? 0 : 1 / resultRank,
    repeat_observation: clamp01(Math.log1p(Math.max(0, input.occurrenceCount - 1)) / Math.log(10)),
    employer_identified: input.employerHint?.trim() ? 1 : 0,
    snippet_available: input.latestSnippet?.trim() ? 1 : 0,
  };

  return {
    leadId: input.leadId,
    values: DISCOVERY_FEATURE_NAMES.map((name) => named[name]),
    named,
    queryFamily: queryFamilyForLead(input),
  };
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function meansAndScales(rows: number[][]): { means: number[]; scales: number[] } {
  const width = rows[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, column) => (
    rows.reduce((sum, row) => sum + row[column], 0) / rows.length
  ));
  const scales = Array.from({ length: width }, (_, column) => {
    const variance = rows.reduce((sum, row) => sum + (row[column] - means[column]) ** 2, 0) / rows.length;
    const scale = Math.sqrt(variance);
    return scale < 1e-8 ? 1 : scale;
  });
  return { means, scales };
}

function standardize(row: number[], means: number[], scales: number[]): number[] {
  return row.map((value, index) => (value - means[index]) / scales[index]);
}

function fitLogisticRegression(
  features: number[][],
  labels: number[],
  options: { iterations?: number; learningRate?: number; l2?: number } = {},
): { coefficients: number[]; intercept: number } {
  if (features.length === 0 || features.length !== labels.length) {
    throw new Error('features and labels must contain the same non-zero number of rows');
  }
  const width = features[0].length;
  if (features.some((row) => row.length !== width)) throw new Error('feature rows must have equal width');
  const iterations = options.iterations ?? 1_200;
  const learningRate = options.learningRate ?? 0.04;
  const l2 = options.l2 ?? 0.08;
  const positives = labels.reduce((sum, label) => sum + label, 0);
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) throw new Error('both classes are required');

  const positiveWeight = labels.length / (2 * positives);
  const negativeWeight = labels.length / (2 * negatives);
  const coefficients = Array.from({ length: width }, () => 0);
  let intercept = Math.log(positives / negatives);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = Array.from({ length: width }, () => 0);
    let interceptGradient = 0;
    for (let rowIndex = 0; rowIndex < features.length; rowIndex += 1) {
      const row = features[rowIndex];
      const label = labels[rowIndex];
      const weight = label === 1 ? positiveWeight : negativeWeight;
      const linear = intercept + row.reduce((sum, value, column) => sum + value * coefficients[column], 0);
      const error = (sigmoid(linear) - label) * weight;
      interceptGradient += error;
      for (let column = 0; column < width; column += 1) gradient[column] += error * row[column];
    }
    intercept -= learningRate * interceptGradient / features.length;
    for (let column = 0; column < width; column += 1) {
      const regularized = gradient[column] / features.length + l2 * coefficients[column];
      coefficients[column] -= learningRate * regularized;
    }
  }
  return { coefficients, intercept };
}

export function predictDiscoveryRelevance(model: LogisticModel, values: number[]): number {
  if (values.length !== model.featureNames.length) throw new Error('feature vector does not match model schema');
  const scaled = standardize(values, model.means, model.scales);
  const linear = model.intercept
    + scaled.reduce((sum, value, index) => sum + value * model.coefficients[index], 0);
  return sigmoid(linear);
}

function logLoss(labels: number[], probabilities: number[]): number {
  const epsilon = 1e-12;
  return labels.reduce((sum, label, index) => {
    const probability = Math.max(epsilon, Math.min(1 - epsilon, probabilities[index]));
    return sum - (label * Math.log(probability) + (1 - label) * Math.log(1 - probability));
  }, 0) / labels.length;
}

function brierScore(labels: number[], probabilities: number[]): number {
  return labels.reduce((sum, label, index) => sum + (probabilities[index] - label) ** 2, 0) / labels.length;
}

function rocAuc(labels: number[], probabilities: number[]): number | null {
  const positives = labels.filter((label) => label === 1).length;
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const ranked = probabilities.map((probability, index) => ({ probability, label: labels[index] }))
    .sort((left, right) => left.probability - right.probability);
  let rankSum = 0;
  let index = 0;
  while (index < ranked.length) {
    let end = index + 1;
    while (end < ranked.length && ranked[end].probability === ranked[index].probability) end += 1;
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      if (ranked[cursor].label === 1) rankSum += averageRank;
    }
    index = end;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function precisionAtK(labels: number[], probabilities: number[], k: number): number | null {
  if (labels.length === 0 || k < 1) return null;
  const selected = probabilities.map((probability, index) => ({ probability, label: labels[index] }))
    .sort((left, right) => right.probability - left.probability)
    .slice(0, Math.min(k, labels.length));
  return selected.reduce((sum, row) => sum + row.label, 0) / selected.length;
}

function buildModel(rows: Array<{ vector: DiscoveryFeatureVector; label: number }>): LogisticModel {
  const values = rows.map((row) => row.vector.values);
  const labels = rows.map((row) => row.label);
  const { means, scales } = meansAndScales(values);
  const scaled = values.map((row) => standardize(row, means, scales));
  const fitted = fitLogisticRegression(scaled, labels);
  return {
    algorithm: 'logistic_regression_v1',
    featureSchemaVersion: DISCOVERY_FEATURE_SCHEMA_VERSION,
    featureNames: DISCOVERY_FEATURE_NAMES,
    means,
    scales,
    coefficients: fitted.coefficients,
    intercept: fitted.intercept,
  };
}

export function trainDiscoveryRanker(
  inputs: DiscoveryLearningInput[],
  options: { minimumRows?: number; minimumPerClass?: number; holdoutFraction?: number } = {},
): DiscoveryTrainingResult {
  const minimumRows = options.minimumRows ?? 30;
  const minimumPerClass = options.minimumPerClass ?? 10;
  const usable = inputs
    .filter((input) => input.label === 'relevant' || input.label === 'irrelevant')
    .map((input) => ({
      input,
      vector: featuresForDiscoveryLead(input),
      label: input.label === 'relevant' ? 1 : 0,
    }))
    .sort((left, right) => Date.parse(left.input.labeledAt) - Date.parse(right.input.labeledAt));
  const positives = usable.filter((row) => row.label === 1).length;
  const negatives = usable.length - positives;
  if (usable.length < minimumRows || positives < minimumPerClass || negatives < minimumPerClass) {
    return {
      status: 'insufficient_data',
      usableRows: usable.length,
      positives,
      negatives,
      minimumRows,
      minimumPerClass,
    };
  }

  const holdoutFraction = Math.max(0.15, Math.min(0.35, options.holdoutFraction ?? 0.2));
  const holdoutSize = Math.max(6, Math.floor(usable.length * holdoutFraction));
  const developmentRows = usable.slice(0, -holdoutSize);
  const holdoutRows = usable.slice(-holdoutSize);
  const developmentPositives = developmentRows.filter((row) => row.label === 1).length;
  const developmentNegatives = developmentRows.length - developmentPositives;

  const gateReasons: string[] = [];
  let evaluationProbabilities: number[] = [];
  let holdoutLabels = holdoutRows.map((row) => row.label);
  if (developmentPositives === 0 || developmentNegatives === 0) {
    gateReasons.push('time-ordered development split does not contain both classes');
  } else {
    const evaluationModel = buildModel(developmentRows);
    evaluationProbabilities = holdoutRows.map((row) => predictDiscoveryRelevance(evaluationModel, row.vector.values));
  }

  const holdoutPositives = holdoutLabels.filter((label) => label === 1).length;
  const holdoutNegatives = holdoutLabels.length - holdoutPositives;
  const prevalence = developmentRows.length === 0 ? positives / usable.length : developmentPositives / developmentRows.length;
  const baselineProbabilities = holdoutLabels.map(() => prevalence);
  const evaluationAvailable = evaluationProbabilities.length === holdoutLabels.length && holdoutLabels.length > 0;
  const auc = evaluationAvailable ? rocAuc(holdoutLabels, evaluationProbabilities) : null;
  const evaluatedLogLoss = evaluationAvailable ? logLoss(holdoutLabels, evaluationProbabilities) : null;
  const baselineLogLoss = holdoutLabels.length > 0 ? logLoss(holdoutLabels, baselineProbabilities) : null;
  const evaluatedBrier = evaluationAvailable ? brierScore(holdoutLabels, evaluationProbabilities) : null;
  const baselineBrier = holdoutLabels.length > 0 ? brierScore(holdoutLabels, baselineProbabilities) : null;
  const k = Math.min(10, holdoutLabels.length);

  if (holdoutPositives < 3 || holdoutNegatives < 3) gateReasons.push('time-ordered holdout needs at least three examples from each class');
  if (auc === null || auc < 0.65) gateReasons.push('holdout ROC AUC is below 0.65 or not measurable');
  if (evaluatedLogLoss === null || baselineLogLoss === null || evaluatedLogLoss >= baselineLogLoss) {
    gateReasons.push('holdout log loss does not beat the prevalence baseline');
  }
  if (evaluatedBrier === null || baselineBrier === null || evaluatedBrier >= baselineBrier) {
    gateReasons.push('holdout Brier score does not beat the prevalence baseline');
  }
  if (usable.length < 60 || positives < 20 || negatives < 20) {
    gateReasons.push('influence requires at least 60 labels and 20 examples from each class');
  }

  const finalModel = buildModel(usable);
  return {
    status: 'trained',
    model: finalModel,
    evaluation: {
      trainingRows: usable.length,
      holdoutRows: holdoutRows.length,
      positives,
      negatives,
      holdoutPositives,
      holdoutNegatives,
      prevalence,
      logLoss: evaluatedLogLoss,
      baselineLogLoss,
      brierScore: evaluatedBrier,
      baselineBrierScore: baselineBrier,
      rocAuc: auc,
      precisionAtK: evaluationAvailable ? precisionAtK(holdoutLabels, evaluationProbabilities, k) : null,
      k,
      passesInfluenceGate: gateReasons.length === 0,
      gateReasons,
    },
    vectors: usable.map((row) => ({
      leadId: row.input.leadId,
      probability: predictDiscoveryRelevance(finalModel, row.vector.values),
      named: row.vector.named,
    })),
  };
}

export interface QueryYieldRow {
  family: string;
  labelled: number;
  relevant: number;
  irrelevant: number;
  posteriorMean: number;
  explorationScore: number;
}

export interface RecallGapSummary {
  total: number;
  byRoute: Array<{ value: string; count: number }>;
  byEmployer: Array<{ value: string; count: number }>;
  byLane: Array<{ value: string; count: number }>;
}

/**
 * Beta(1,1)-smoothed query yield with an upper-confidence exploration term.
 * This reports where useful leads came from without starving new query families.
 */
export function summarizeQueryYield(inputs: DiscoveryLearningInput[]): QueryYieldRow[] {
  const eligible = inputs.filter((input) => (
    (input.label === 'relevant' || input.label === 'irrelevant')
    && input.labelSource !== 'missed_role'
  ));
  const counts = new Map<string, { relevant: number; irrelevant: number }>();
  for (const input of eligible) {
    const family = queryFamilyForLead(input);
    const current = counts.get(family) ?? { relevant: 0, irrelevant: 0 };
    if (input.label === 'relevant') current.relevant += 1;
    else current.irrelevant += 1;
    counts.set(family, current);
  }
  const total = Math.max(1, eligible.length);
  return [...counts.entries()].map(([family, count]) => {
    const labelled = count.relevant + count.irrelevant;
    const posteriorMean = (count.relevant + 1) / (labelled + 2);
    const exploration = Math.sqrt(2 * Math.log(total + 1) / labelled);
    return {
      family,
      labelled,
      relevant: count.relevant,
      irrelevant: count.irrelevant,
      posteriorMean,
      explorationScore: Math.min(1, posteriorMean + exploration),
    };
  }).sort((left, right) => right.explorationScore - left.explorationScore || left.family.localeCompare(right.family));
}

function countedValues(values: Array<string | null | undefined>, fallback: string, limit = 25) {
  const counts = new Map<string, { value: string; count: number }>();
  for (const rawValue of values) {
    const value = rawValue?.trim().replace(/\s+/g, ' ') || fallback;
    const key = value.toLocaleLowerCase('en-US');
    const current = counts.get(key) ?? { value, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, limit);
}

/** Reports positive examples supplied outside automated discovery as recall gaps. */
export function summarizeRecallGaps(inputs: DiscoveryLearningInput[]): RecallGapSummary {
  const missed = inputs.filter((input) => input.labelSource === 'missed_role');
  return {
    total: missed.length,
    byRoute: countedValues(missed.map((input) => input.route), 'unknown_route'),
    byEmployer: countedValues(missed.map((input) => input.employerHint), 'Employer not identified'),
    byLane: countedValues(missed.map((input) => input.lane), 'all_lanes'),
  };
}
