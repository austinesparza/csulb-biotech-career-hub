import { evaluateClassificationFeedback } from '../src/lib/pipeline/classification-learning';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

const db = createPipelineServiceClient();
const { data, error } = await db
  .from('opportunity_classification_feedback')
  .select('id, opportunity_id, proposal_source, taxonomy_version, proposed_tags, final_tags, created_at')
  .order('created_at', { ascending: true })
  .limit(10_000);
if (error) throw new Error(`load classification feedback: ${error.message}`);

console.log(JSON.stringify(evaluateClassificationFeedback(data ?? []), null, 2));
