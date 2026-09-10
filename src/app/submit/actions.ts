'use server';

import { storePublicSubmission } from '@/lib/supabase/public-submissions';
import { validatePublicSubmission } from '@/lib/submissions';

export type SubmitResult = { ok: true } | { ok: false; error: string };

export async function submitSuggestion(formData: FormData): Promise<SubmitResult> {
  // Bots commonly fill this hidden field. Return success so they do not learn
  // which control rejected them.
  if (String(formData.get('website') ?? '').trim()) return { ok: true };

  const parsed = validatePublicSubmission(formData);
  if (!parsed.ok) return parsed;

  try {
    await storePublicSubmission(parsed.value);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && /daily submission limit/i.test(error.message)) {
      return { ok: false, error: 'The submission queue is full for today. Please email the club instead.' };
    }
    return { ok: false, error: 'Could not send right now. Please email us instead.' };
  }
}
