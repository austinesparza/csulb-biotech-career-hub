'use server';

import { revalidatePath } from 'next/cache';
import {
  buildPublishedCorrection,
  type OpportunityCorrectionDraft,
  validateRevisionReason,
} from '@/lib/opportunity-corrections';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { validateEmployerControlledSourceUrl } from '@/lib/discovery-promotion';

async function closeStaleTasks(db: ReturnType<typeof createServiceClient>, id: string, userId: string): Promise<boolean> {
  const { error } = await db.from('review_tasks').update({
    status: 'done', resolved_at: new Date().toISOString(), decided_by: userId,
  }).eq('task_type', 'stale_record').eq('entity_table', 'opportunities')
    .eq('entity_id', id).in('status', ['open', 'in_progress']);
  revalidatePath('/admin/review');
  return !error;
}

export interface SaveCorrectionInput {
  id: string;
  expectedUpdatedAt: string;
  reason: string;
  sourceConfirmed: boolean;
  publicSafeConfirmed: boolean;
  draft: OpportunityCorrectionDraft;
}

/** Record an officer's fresh employer check even when the posting details have not changed. */
export async function verifyPublishedOpportunity(input: Omit<SaveCorrectionInput, 'draft'>): Promise<{ message: string }> {
  const { user } = await requireOfficer();
  requireConfirmations(input.sourceConfirmed, input.publicSafeConfirmed);
  const reason = validateRevisionReason(input.reason);
  const db = createServiceClient();
  const { data: current, error: loadError } = await db.from('opportunities')
    .select('id, review_status, public_safe, status, posting_url')
    .eq('id', input.id).single();
  if (loadError || !current) throw new Error(loadError?.message ?? 'Opportunity not found');
  if (current.review_status !== 'approved' || !current.public_safe || current.status !== 'open_verified' || !current.posting_url) {
    throw new Error('Only a published, verified posting with an employer link can be rechecked');
  }
  if (!validateEmployerControlledSourceUrl(current.posting_url).valid) {
    throw new Error('Find an individual employer or ATS posting before confirming this record is still open');
  }
  const { error } = await db.rpc('revise_published_opportunity', {
    p_opportunity_id: input.id,
    p_changed_by: user.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_action: 'correction',
    p_reason: reason,
    p_changes: {},
    p_source_confirmed: true,
    p_public_safe_confirmed: true,
    p_restore_revision_id: null,
  });
  if (error) throw new Error(error.message);
  const tasksClosed = await closeStaleTasks(db, input.id, user.id);
  revalidateCorrectionViews();
  revalidatePath('/admin/review');
  return { message: !tasksClosed
    ? 'Source recheck saved, but its review task could not be closed. Please resolve the task separately.'
    : 'Source recheck recorded and stale review task closed.' };
}

interface CurrentPublishedOpportunity {
  id: string;
  updated_at: string;
  review_status: string;
  public_safe: boolean;
  status: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  start_date_text: string | null;
  paid_status: string;
  application_type: string | null;
  public_notes: string | null;
  audience_bucket: string;
  audience_reason: string | null;
  graduate_stage: string;
  eligibility_evidence: string | null;
  work_authorization: string | null;
  dedupe_key: string | null;
  family_key: string | null;
  companies: { name: string } | Array<{ name: string }> | null;
}

function revalidateCorrectionViews() {
  for (const path of ['/', '/internships', '/calendar', '/companies', '/admin', '/admin/manage']) {
    revalidatePath(path);
  }
}

function requireConfirmations(sourceConfirmed: boolean, publicSafeConfirmed: boolean) {
  if (!sourceConfirmed || !publicSafeConfirmed) {
    throw new Error('Confirm the official source and public-safe fields before saving');
  }
}

export async function saveOpportunityCorrection(input: SaveCorrectionInput): Promise<{ message: string }> {
  const { user } = await requireOfficer();
  requireConfirmations(input.sourceConfirmed, input.publicSafeConfirmed);
  const reason = validateRevisionReason(input.reason);
  const db = createServiceClient();
  const { data: loadedCurrent, error: loadError } = await db
    .from('opportunities')
    .select(
      'id, updated_at, review_status, public_safe, status, title, posting_url, location, eligibility, ' +
      'focus_area, deadline, deadline_text, start_date_text, paid_status, application_type, public_notes, ' +
      'audience_bucket, audience_reason, graduate_stage, eligibility_evidence, work_authorization, ' +
      'dedupe_key, family_key, companies(name)',
    )
    .eq('id', input.id)
    .single();
  if (loadError || !loadedCurrent) throw new Error(loadError?.message ?? 'Opportunity not found');
  const current = loadedCurrent as unknown as CurrentPublishedOpportunity;
  if (current.review_status !== 'approved' || !current.public_safe
      || !['open_verified', 'open_unverified'].includes(current.status)) {
    throw new Error('This opportunity is not currently published');
  }

  const companyRelation = current.companies;
  const companyName = Array.isArray(companyRelation) ? companyRelation[0]?.name : companyRelation?.name;
  if (!companyName) throw new Error('Opportunity company is missing');
  const changes = buildPublishedCorrection(input.draft, companyName);
  const comparableCurrent = {
    title: current.title,
    posting_url: current.posting_url,
    location: current.location,
    eligibility: current.eligibility,
    focus_area: current.focus_area,
    deadline: current.deadline,
    deadline_text: current.deadline_text,
    start_date_text: current.start_date_text,
    paid_status: current.paid_status,
    application_type: current.application_type,
    status: current.status,
    public_notes: current.public_notes,
    audience_bucket: current.audience_bucket,
    audience_reason: current.audience_reason,
    graduate_stage: current.graduate_stage,
    eligibility_evidence: current.eligibility_evidence,
    work_authorization: current.work_authorization,
    dedupe_key: current.dedupe_key,
    family_key: current.family_key,
  };
  if (JSON.stringify(changes) === JSON.stringify(comparableCurrent)) {
    throw new Error('No fields changed');
  }

  const { error } = await db.rpc('revise_published_opportunity', {
    p_opportunity_id: input.id,
    p_changed_by: user.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_action: 'correction',
    p_reason: reason,
    p_changes: changes,
    p_source_confirmed: true,
    p_public_safe_confirmed: true,
    p_restore_revision_id: null,
  });
  if (error) throw new Error(error.message);
  revalidateCorrectionViews();
  const tasksClosed = await closeStaleTasks(db, input.id, user.id);
  return { message: tasksClosed ? 'Correction saved and published' : 'Correction saved, but its stale review task could not be closed.' };
}

export async function unpublishOpportunity(input: {
  id: string;
  expectedUpdatedAt: string;
  reason: string;
}): Promise<{ message: string }> {
  const { user } = await requireOfficer();
  const db = createServiceClient();
  const { error } = await db.rpc('revise_published_opportunity', {
    p_opportunity_id: input.id,
    p_changed_by: user.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_action: 'unpublish',
    p_reason: validateRevisionReason(input.reason),
    p_changes: {},
    p_source_confirmed: false,
    p_public_safe_confirmed: false,
    p_restore_revision_id: null,
  });
  if (error) throw new Error(error.message);
  revalidateCorrectionViews();
  const tasksClosed = await closeStaleTasks(db, input.id, user.id);
  return { message: tasksClosed ? 'Removed from the public website. The prior version can be restored.' : 'Removed from the public website, but its stale review task could not be closed.' };
}

export async function restoreOpportunityRevision(input: {
  id: string;
  revisionId: string;
  expectedUpdatedAt: string;
  reason: string;
  sourceConfirmed: boolean;
  publicSafeConfirmed: boolean;
}): Promise<{ message: string }> {
  const { user } = await requireOfficer();
  requireConfirmations(input.sourceConfirmed, input.publicSafeConfirmed);
  const db = createServiceClient();
  const { error } = await db.rpc('revise_published_opportunity', {
    p_opportunity_id: input.id,
    p_changed_by: user.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_action: 'restore',
    p_reason: validateRevisionReason(input.reason),
    p_changes: {},
    p_source_confirmed: true,
    p_public_safe_confirmed: true,
    p_restore_revision_id: input.revisionId,
  });
  if (error) throw new Error(error.message);
  revalidateCorrectionViews();
  const tasksClosed = await closeStaleTasks(db, input.id, user.id);
  return { message: tasksClosed ? 'Earlier version restored and recorded as a new revision' : 'Earlier version restored, but its stale review task could not be closed.' };
}
