'use server';
// Review queue actions. Every action re-verifies officer status before using
// the service client (repo invariant #7).
import { revalidatePath } from 'next/cache';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

function revalidatePublic() {
  revalidatePath('/');
  revalidatePath('/internships');
  revalidatePath('/companies');
  revalidatePath('/admin/review');
}

/**
 * Approve guardrail lives in the UI (link opened + notes confirmed), but the
 * server enforces the hard parts: officer auth, a valid target status, and
 * that public_notes going live were explicitly provided by the officer.
 */
export async function approveOpportunity(input: {
  id: string;
  status: 'open_verified' | 'open_unverified';
  publicNotes: string;
  makeCompanyPublic: boolean;
}): Promise<void> {
  await requireOfficer();
  if (!['open_verified', 'open_unverified'].includes(input.status)) {
    throw new Error('Invalid target status');
  }
  const db = createServiceClient();

  const { data: opp } = await db
    .from('opportunities')
    .select('id, company_id')
    .eq('id', input.id)
    .single();
  if (!opp) throw new Error('Opportunity not found');

  const { error } = await db
    .from('opportunities')
    .update({
      status: input.status,
      review_status: 'approved',
      public_safe: true,
      public_notes: input.publicNotes.trim() || null,
      last_checked_at: input.status === 'open_verified' ? new Date().toISOString() : null,
    })
    .eq('id', input.id);
  if (error) throw new Error(error.message);

  if (input.makeCompanyPublic && opp.company_id) {
    await db.from('companies').update({ public_safe: true }).eq('id', opp.company_id);
  }
  revalidatePublic();
}

export async function rejectOpportunity(id: string, reason: 'not_relevant' | 'hidden'): Promise<void> {
  await requireOfficer();
  const db = createServiceClient();
  const { error } = await db
    .from('opportunities')
    .update({ status: reason, review_status: 'rejected', public_safe: false })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePublic();
}

export async function markDuplicate(id: string, duplicateOf: string): Promise<void> {
  await requireOfficer();
  const db = createServiceClient();
  const { error } = await db
    .from('opportunities')
    .update({ status: 'duplicate', duplicate_of: duplicateOf, public_safe: false })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePublic();
}
