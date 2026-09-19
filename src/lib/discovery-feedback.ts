import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DISCOVERY_FEATURE_SCHEMA_VERSION,
  featuresForDiscoveryLead,
  type DiscoveryLearningInput,
  type DiscoveryLearningLabel,
} from './pipeline/discovery-learning';

export type DiscoveryFeedbackSource = 'officer' | 'promotion' | 'missed_role';

export async function recordDiscoveryFeedback(
  db: SupabaseClient,
  input: {
    leadId: string;
    decidedBy: string;
    label: DiscoveryLearningLabel;
    reason: string;
    source: DiscoveryFeedbackSource;
    archiveLead?: boolean;
  },
): Promise<string> {
  const reason = input.reason.trim();
  if (reason.length < 8 || reason.length > 1_000) {
    throw new Error('Feedback reason must be from 8 to 1000 characters');
  }
  if (input.archiveLead && input.label === 'relevant') {
    throw new Error('Relevant feedback cannot archive a lead');
  }
  const { data: lead, error: leadError } = await db.from('discovery_leads')
    .select('id, route, resolution, occurrence_count, employer_hint, latest_snippet, lane')
    .eq('id', input.leadId)
    .single();
  if (leadError || !lead) throw new Error('Discovery lead not found');
  const { data: observation, error: observationError } = await db.from('discovery_lead_observations')
    .select('raw_metadata')
    .eq('lead_id', input.leadId)
    .order('retrieved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (observationError) throw new Error(`load discovery evidence: ${observationError.message}`);
  const learningInput: DiscoveryLearningInput = {
    leadId: lead.id,
    label: input.label,
    labeledAt: new Date().toISOString(),
    route: lead.route,
    resolution: lead.resolution,
    occurrenceCount: lead.occurrence_count,
    employerHint: lead.employer_hint,
    latestSnippet: lead.latest_snippet,
    lane: lead.lane,
    observationMetadata: observation?.raw_metadata ?? {},
  };
  const vector = featuresForDiscoveryLead(learningInput);
  const { data, error } = await db.rpc('record_discovery_feedback', {
    p_lead_id: input.leadId,
    p_decided_by: input.decidedBy,
    p_label: input.label,
    p_reason: reason,
    p_label_source: input.source,
    p_archive_lead: input.archiveLead ?? false,
    p_feature_schema_version: DISCOVERY_FEATURE_SCHEMA_VERSION,
    p_feature_snapshot: vector.named,
    p_query_family: vector.queryFamily,
  });
  if (error) throw new Error(`record discovery feedback: ${error.message}`);
  if (typeof data !== 'string' || !data) throw new Error('record discovery feedback returned no ID');
  return data;
}
