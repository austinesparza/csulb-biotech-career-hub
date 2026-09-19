import {
  DISCOVERY_FEATURE_SCHEMA_VERSION,
  featuresForDiscoveryLead,
  predictDiscoveryRelevance,
  summarizeRecallGaps,
  summarizeQueryYield,
  trainDiscoveryRanker,
  type DiscoveryLearningInput,
  type DiscoveryLearningLabel,
} from '../src/lib/pipeline/discovery-learning';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

interface FeedbackRow {
  lead_id: string;
  label: DiscoveryLearningLabel;
  created_at: string;
  feature_schema_version: number;
  feature_snapshot: Record<string, unknown>;
  query_family: string;
  label_source: 'officer' | 'promotion' | 'missed_role';
}

interface LeadRow {
  id: string;
  route: DiscoveryLearningInput['route'];
  resolution: DiscoveryLearningInput['resolution'];
  occurrence_count: number;
  employer_hint: string | null;
  latest_snippet: string | null;
  lane: string | null;
  officer_status: string;
}

interface ObservationRow {
  lead_id: string;
  retrieved_at: string;
  raw_metadata: Record<string, unknown>;
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => (
    values.slice(index * size, index * size + size)
  ));
}

const db = createPipelineServiceClient();
const { data: feedbackData, error: feedbackError } = await db
  .from('discovery_feedback')
  .select('lead_id, label, created_at, feature_schema_version, feature_snapshot, query_family, label_source')
  .order('created_at', { ascending: false })
  .limit(10_000);
if (feedbackError) throw new Error(`load discovery feedback: ${feedbackError.message}`);

const latestFeedback = new Map<string, FeedbackRow>();
for (const row of (feedbackData ?? []) as FeedbackRow[]) {
  if (!latestFeedback.has(row.lead_id)) latestFeedback.set(row.lead_id, row);
}

const { data: leadData, error: leadError } = await db
  .from('discovery_leads')
  .select('id, route, resolution, occurrence_count, employer_hint, latest_snippet, lane, officer_status')
  .order('last_seen_at', { ascending: false })
  .limit(10_000);
if (leadError) throw new Error(`load discovery leads: ${leadError.message}`);
const leads = (leadData ?? []) as LeadRow[];

const latestObservation = new Map<string, ObservationRow>();
for (const idChunk of chunks(leads.map((lead) => lead.id), 100)) {
  const { data, error } = await db
    .from('discovery_lead_observations')
    .select('lead_id, retrieved_at, raw_metadata')
    .in('lead_id', idChunk)
    .order('retrieved_at', { ascending: false })
    .limit(5_000);
  if (error) throw new Error(`load discovery observations: ${error.message}`);
  for (const row of (data ?? []) as ObservationRow[]) {
    if (!latestObservation.has(row.lead_id)) latestObservation.set(row.lead_id, row);
  }
}

const inputs = leads.flatMap((lead): DiscoveryLearningInput[] => {
  const feedback = latestFeedback.get(lead.id);
  if (!feedback) return [];
  if (feedback.feature_schema_version !== DISCOVERY_FEATURE_SCHEMA_VERSION) return [];
  return [{
    leadId: lead.id,
    label: feedback.label,
    labeledAt: feedback.created_at,
    route: lead.route,
    resolution: lead.resolution,
    occurrenceCount: lead.occurrence_count,
    employerHint: lead.employer_hint,
    latestSnippet: lead.latest_snippet,
    lane: lead.lane,
    observationMetadata: latestObservation.get(lead.id)?.raw_metadata ?? {},
    labelSource: feedback.label_source,
    featureSnapshot: feedback.feature_snapshot,
    queryFamilySnapshot: feedback.query_family,
  }];
});

const training = trainDiscoveryRanker(inputs);
const queryYield = summarizeQueryYield(inputs);
const recallGaps = summarizeRecallGaps(inputs);
if (training.status === 'insufficient_data') {
  console.log(JSON.stringify({
    status: training.status,
    labels: {
      usable: training.usableRows,
      relevant: training.positives,
      irrelevant: training.negatives,
      required: training.minimumRows,
      requiredPerClass: training.minimumPerClass,
    },
    queryYield,
    recallGaps,
    persisted: false,
  }, null, 2));
  process.exit(0);
}

const trainedThrough = inputs.reduce((latest, input) => (
  Date.parse(input.labeledAt) > Date.parse(latest) ? input.labeledAt : latest
), inputs[0].labeledAt);
const modelStatus = training.evaluation.passesInfluenceGate ? 'eligible' : 'shadow';
const { data: modelRow, error: modelError } = await db
  .from('discovery_model_versions')
  .insert({
    algorithm: training.model.algorithm,
    feature_schema_version: DISCOVERY_FEATURE_SCHEMA_VERSION,
    trained_through: trainedThrough,
    training_rows: training.evaluation.trainingRows,
    positive_rows: training.evaluation.positives,
    negative_rows: training.evaluation.negatives,
    model: training.model,
    metrics: { ...training.evaluation, queryYield, recallGaps },
    status: modelStatus,
  })
  .select('id')
  .single();
if (modelError || !modelRow) throw new Error(`persist discovery model: ${modelError?.message ?? 'missing model row'}`);

const predictionRows = leads
  .filter((lead) => ['new', 'in_review'].includes(lead.officer_status))
  .map((lead) => {
    const feedback = latestFeedback.get(lead.id);
    const input: DiscoveryLearningInput = {
      leadId: lead.id,
      label: feedback?.label ?? 'unverifiable',
      labeledAt: feedback?.created_at ?? new Date(0).toISOString(),
      route: lead.route,
      resolution: lead.resolution,
      occurrenceCount: lead.occurrence_count,
      employerHint: lead.employer_hint,
      latestSnippet: lead.latest_snippet,
      lane: lead.lane,
      observationMetadata: latestObservation.get(lead.id)?.raw_metadata ?? {},
    };
    const vector = featuresForDiscoveryLead(input);
    return {
      lead_id: lead.id,
      model_id: modelRow.id,
      probability: predictDiscoveryRelevance(training.model, vector.values),
      feature_snapshot: vector.named,
    };
  });

for (const predictionChunk of chunks(predictionRows, 500)) {
  const { error } = await db.from('discovery_lead_predictions').upsert(predictionChunk, {
    onConflict: 'lead_id,model_id',
  });
  if (error) throw new Error(`persist discovery predictions: ${error.message}`);
}

console.log(JSON.stringify({
  status: 'trained',
  modelId: modelRow.id,
  modelStatus,
  evaluation: training.evaluation,
  queryYield,
  recallGaps,
  predictions: predictionRows.length,
  persisted: true,
}, null, 2));
