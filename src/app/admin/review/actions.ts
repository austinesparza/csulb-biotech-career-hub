'use server';
// Review queue actions. Every action re-verifies officer status before using
// the service client (repo invariant #7).
import { revalidatePath } from 'next/cache';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import type { AudienceBucket, GraduateStage } from '@/lib/types';

const PUBLISHABLE_AUDIENCES: AudienceBucket[] = ['graduate', 'mixed'];
const PUBLISHABLE_STAGES: GraduateStage[] = [
  'msc_year_1', 'msc_year_2', 'msc_any', 'mixed_graduate', 'graduate_unspecified',
];

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
  audienceBucket: AudienceBucket;
  audienceReason: string;
  graduateStage: GraduateStage;
  sourceConfirmed: boolean;
  publicSafeConfirmed: boolean;
}): Promise<void> {
  const { user } = await requireOfficer();
  if (!['open_verified', 'open_unverified'].includes(input.status)) {
    throw new Error('Invalid target status');
  }
  if (!PUBLISHABLE_AUDIENCES.includes(input.audienceBucket)) {
    throw new Error("Only master's-accessible records can be published");
  }
  if (!PUBLISHABLE_STAGES.includes(input.graduateStage)) {
    throw new Error("Choose the master's stage supported by the posting");
  }
  if (!input.sourceConfirmed || !input.publicSafeConfirmed) {
    throw new Error('Confirm the source and public-safe fields before approval');
  }
  const audienceReason = input.audienceReason.trim();
  if (audienceReason.length < 8) {
    throw new Error('Add a concise evidence-based audience reason');
  }
  const db = createServiceClient();

  const { data: opp } = await db
    .from('opportunities')
    .select('id, company_id, scientific_lanes, job_functions, methods')
    .eq('id', input.id)
    .single();
  if (!opp) throw new Error('Opportunity not found');

  const { error } = await db.rpc('decide_opportunity_review', {
    p_opportunity_id: input.id,
    p_decided_by: user.id,
    p_decision: 'approve',
    p_target_status: input.status,
    p_public_notes: input.publicNotes.trim(),
    p_make_company_public: input.makeCompanyPublic,
    p_audience_bucket: input.audienceBucket,
    p_audience_reason: audienceReason,
    p_graduate_stage: input.graduateStage,
    p_final_fields: {
      scientific_lanes: opp.scientific_lanes ?? [],
      job_functions: opp.job_functions ?? [],
      methods: opp.methods ?? [],
    },
    p_source_confirmed: input.sourceConfirmed,
    p_public_safe_confirmed: input.publicSafeConfirmed,
  });
  if (error) throw new Error(error.message);
  revalidatePublic();
}

export async function archiveForAudience(input: {
  id: string;
  audienceBucket: Extract<AudienceBucket, 'ineligible' | 'adjacent' | 'special'>;
  audienceReason: string;
  graduateStage: GraduateStage;
  sourceConfirmed: boolean;
  publicSafeConfirmed: boolean;
}): Promise<void> {
  const { user } = await requireOfficer();
  const audienceReason = input.audienceReason.trim();
  if (audienceReason.length < 8) {
    throw new Error('Add a concise evidence-based audience reason');
  }
  if (!['ineligible', 'adjacent', 'special'].includes(input.audienceBucket)) {
    throw new Error('Invalid archive audience');
  }

  const db = createServiceClient();
  const { data: opp } = await db
    .from('opportunities')
    .select('scientific_lanes, job_functions, methods')
    .eq('id', input.id)
    .single();
  if (!opp) throw new Error('Opportunity not found');

  const { error } = await db.rpc('decide_opportunity_review', {
    p_opportunity_id: input.id,
    p_decided_by: user.id,
    p_decision: 'archive',
    p_target_status: 'archive_only',
    p_public_notes: '',
    p_make_company_public: false,
    p_audience_bucket: input.audienceBucket,
    p_audience_reason: audienceReason,
    p_graduate_stage: input.graduateStage,
    p_final_fields: {
      scientific_lanes: opp.scientific_lanes ?? [],
      job_functions: opp.job_functions ?? [],
      methods: opp.methods ?? [],
    },
    p_source_confirmed: input.sourceConfirmed,
    p_public_safe_confirmed: input.publicSafeConfirmed,
  });
  if (error) throw new Error(error.message);
  revalidatePublic();
}

export async function rejectOpportunity(id: string, reason: 'not_relevant' | 'hidden'): Promise<void> {
  const { user } = await requireOfficer();
  const db = createServiceClient();
  const { data: opp } = await db
    .from('opportunities')
    .select('graduate_stage, audience_bucket, audience_reason')
    .eq('id', id)
    .single();
  if (!opp) throw new Error('Opportunity not found');
  const { error } = await db.rpc('decide_opportunity_review', {
    p_opportunity_id: id,
    p_decided_by: user.id,
    p_decision: 'reject',
    p_target_status: reason,
    p_public_notes: '',
    p_make_company_public: false,
    p_audience_bucket: opp.audience_bucket === 'unknown' ? 'ineligible' : opp.audience_bucket,
    p_audience_reason: opp.audience_reason?.trim() || `Officer rejected as ${reason.replace('_', ' ')}`,
    p_graduate_stage: opp.graduate_stage ?? 'unknown',
    p_final_fields: {},
    p_source_confirmed: false,
    p_public_safe_confirmed: false,
  });
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
