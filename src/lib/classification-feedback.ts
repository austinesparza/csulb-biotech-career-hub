import type { SupabaseClient } from '@supabase/supabase-js';

/** Stop before a review mutation when its atomic feedback schema is absent. */
export async function assertClassificationFeedbackReady(db: SupabaseClient): Promise<void> {
  const { error } = await db.from('opportunity_classification_feedback').select('id').limit(1);
  if (error) {
    throw new Error('Classification feedback is not available until its database migration is deployed');
  }
}
