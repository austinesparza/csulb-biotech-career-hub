'use server';

import { revalidatePath } from 'next/cache';
import { requireOfficer, createServiceClient } from '@/lib/supabase/server';
import { runAltosLabsPilot, type AltosIngestionSummary } from '@/lib/ingestion/manual-ingestion-pilot';

/**
 * Officer-only server action that triggers a single Altos Labs Greenhouse
 * ingestion run.
 *
 * Security:
 * - requireOfficer() is called before createServiceClient() (invariant #7).
 * - No board token, URL, source ID, company name, or endpoint is accepted
 *   from FormData or any client input.
 * - Only the fixed Altos pilot configuration is used.
 * - The workerId is derived from the authenticated user ID server-side and
 *   is never exposed to the browser.
 * - The returned summary contains no raw response body, payload contents,
 *   or DB credentials.
 */
export async function triggerAltosIngestion(): Promise<AltosIngestionSummary> {
  const { user } = await requireOfficer();
  const client = createServiceClient();

  const workerId = `officer:${user.id}`;

  const summary = await runAltosLabsPilot({
    db: client as any,
    storage: client.storage as any,
    workerId,
  });

  revalidatePath('/admin');
  revalidatePath('/admin/ingestion');
  revalidatePath('/admin/review');

  return summary;
}
