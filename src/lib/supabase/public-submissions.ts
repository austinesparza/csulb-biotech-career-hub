import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { PublicSubmission } from '@/lib/submissions';

/**
 * Narrow server-side capability for public intake. The service credential never
 * reaches the browser, and this module exposes only the rate-limited database RPC.
 */
export async function storePublicSubmission(input: PublicSubmission): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Submission service is not configured');

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await db.rpc('accept_public_submission', {
    p_submission_type: input.submissionType,
    p_payload: input.payload,
    p_submitter_name: input.submitterName,
    p_submitter_email: input.submitterEmail,
  });
  if (error) throw new Error(error.message);
}
