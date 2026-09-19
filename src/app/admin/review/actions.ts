'use server';
// Review queue actions. Every action re-verifies officer status before using
// the service client (repo invariant #7).
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { recordDiscoveryFeedback } from '@/lib/discovery-feedback';
import { validateEmployerControlledSourceUrl } from '@/lib/discovery-promotion';
import { canonicalizeUrl } from '@/lib/ingestion/normalize';
import { archiveDiscoveryLead } from '@/lib/pipeline/lead-store-supabase';
import { resolveLead, type DiscoveryRoute } from '@/lib/pipeline/search-plan';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import type { AudienceBucket, GraduateStage } from '@/lib/types';
import { quickAddOpportunity } from '@/app/admin/add/actions';
import { isPublishableAudienceStage } from '@/lib/opportunityAudience';

const PUBLISHABLE_AUDIENCES: AudienceBucket[] = ['undergraduate', 'graduate', 'mixed'];

export interface ReviewFinalFields {
  scientificLanes: string[];
  jobFunctions: string[];
  methods: string[];
}

export type ReviewActionResult = { ok: true } | { ok: false; error: string };

function safeReviewActionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const allowed = [
    'Invalid target status',
    'Only student-accessible records can be published',
    'Choose the student stage supported by the posting',
    'Confirm the source and public-safe fields before approval',
    'Add a concise evidence-based audience reason',
    'Opportunity not found',
    'Invalid archive audience',
  ];
  if (allowed.includes(message)) return message;
  if (message === 'Not signed in') return 'Your officer session expired. Refresh and sign in again.';
  if (message === 'Not an active officer') return 'This account is not an active officer.';
  return 'The review decision failed before completion. No publication change was made.';
}

async function runReviewAction(
  operation: 'approve' | 'archive' | 'reject',
  opportunityId: string,
  run: () => Promise<void>,
): Promise<ReviewActionResult> {
  try {
    await run();
    console.info('[review-action] completed', { operation, opportunityId });
    return { ok: true };
  } catch (error) {
    const safeError = safeReviewActionError(error);
    console.error('[review-action] failed', { operation, opportunityId, error: safeError });
    return { ok: false, error: safeError };
  }
}

function cleanControlledValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .filter((value) => value.length <= 100)
    .slice(0, 50);
}

function revalidatePublic() {
  revalidatePath('/');
  revalidatePath('/internships');
  revalidatePath('/companies');
  revalidatePath('/admin/review');
}

function requiredFormText(formData: FormData, name: string): string {
  const value = String(formData.get(name) ?? '').trim();
  if (!value) throw new Error(`${name.replaceAll('_', ' ')} is required`);
  return value;
}

/** Resolve a non-opportunity submission after an officer has checked it. */
export async function resolveSubmission(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const id = requiredFormText(formData, 'id');
  const status = requiredFormText(formData, 'status');
  if (!['approved', 'rejected', 'spam'].includes(status)) throw new Error('Invalid submission decision');
  const db = createServiceClient();
  const { data, error } = await db.from('user_submissions').update({
    status,
    notes: String(formData.get('notes') ?? '').trim() || null,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id).in('status', ['new', 'in_review']).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Submission was already resolved');
  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

/** Convert a public suggestion to a private draft in the normal review queue. */
export async function convertSubmissionToDraft(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const id = requiredFormText(formData, 'id');
  const db = createServiceClient();
  const { data: submission, error: loadError } = await db
    .from('user_submissions')
    .select('id, submission_type, status, created_opportunity_id')
    .eq('id', id)
    .single();
  if (loadError || !submission) throw new Error(loadError?.message ?? 'Submission not found');
  if (submission.submission_type !== 'opportunity') throw new Error('Only opportunity suggestions can become drafts');
  if (submission.created_opportunity_id) throw new Error('This submission already has a review draft');
  if (!['new', 'in_review'].includes(submission.status)) throw new Error('This submission is already resolved');

  const { data: source, error: sourceError } = await db
    .from('source_records')
    .select('id')
    .eq('name', 'Student Submissions Form')
    .single();
  if (sourceError || !source) throw new Error('Student Submissions Form source is missing');

  await db.from('user_submissions').update({ status: 'in_review' }).eq('id', id);
  const draft = new FormData();
  draft.set('company', requiredFormText(formData, 'company'));
  draft.set('title', requiredFormText(formData, 'title'));
  draft.set('posting_url', requiredFormText(formData, 'posting_url'));
  draft.set('private_notes', String(formData.get('details') ?? '').trim());
  draft.set('source_record_id', source.id);
  const created = await quickAddOpportunity(draft);

  const { data: updated, error: updateError } = await db.from('user_submissions').update({
    status: 'approved',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    created_opportunity_id: created.id,
    notes: 'Converted to a private review draft. Publication still requires officer approval.',
  }).eq('id', id).is('created_opportunity_id', null).select('id').maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!updated) throw new Error('Submission was converted concurrently; review the opportunity queue');
  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

export async function resolveReviewTask(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const id = requiredFormText(formData, 'id');
  const status = requiredFormText(formData, 'status');
  if (!['done', 'dismissed'].includes(status)) throw new Error('Invalid task decision');
  const db = createServiceClient();
  const { data, error } = await db.from('review_tasks').update({
    status,
    resolved_at: new Date().toISOString(),
    decided_by: user.id,
  }).eq('id', id).in('status', ['open', 'in_progress']).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Task was already resolved');
  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

/** Manage private discovery workflow state. This never creates or publishes an opportunity. */
export async function updateDiscoveryLeadStatus(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const id = requiredFormText(formData, 'id');
  const status = requiredFormText(formData, 'status');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid discovery lead ID');
  }
  if (!['new', 'in_review'].includes(status)) {
    throw new Error('Invalid discovery lead decision');
  }

  const db = createServiceClient();
  const { data, error } = await db.from('discovery_leads').update({
    officer_status: status,
    updated_at: new Date().toISOString(),
  }).eq('id', id).in('officer_status', ['new', 'in_review']).select('id').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Discovery lead was already resolved');

  const taskUpdate = status === 'in_review'
    ? { status: 'in_progress', assigned_to: user.id, resolved_at: null, decided_by: null }
    : { status: 'open', assigned_to: null, resolved_at: null, decided_by: null };
  const { error: taskError } = await db.from('review_tasks').update(taskUpdate)
    .eq('entity_table', 'discovery_leads')
    .eq('entity_id', id)
    .in('status', ['open', 'in_progress']);
  if (taskError) throw new Error(taskError.message);

  revalidatePath('/admin');
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/review');
}

/** Record an explicit learning label. Only `irrelevant` is a model negative. */
export async function recordDiscoveryLeadDecision(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const id = requiredFormText(formData, 'id');
  const label = requiredFormText(formData, 'label');
  const reason = requiredFormText(formData, 'reason');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid discovery lead ID');
  }
  if (!['relevant', 'irrelevant', 'duplicate', 'closed', 'unverifiable'].includes(label)) {
    throw new Error('Invalid discovery feedback label');
  }
  const archiveLead = label !== 'relevant';
  const db = createServiceClient();
  await recordDiscoveryFeedback(db, {
    leadId: id,
    decidedBy: user.id,
    label: label as 'relevant' | 'irrelevant' | 'duplicate' | 'closed' | 'unverifiable',
    reason,
    source: 'officer',
    archiveLead,
  });
  revalidatePath('/admin');
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/review');
}

function manualDiscoveryRoute(url: string): DiscoveryRoute {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  return host === 'linkedin.com' || host.endsWith('.linkedin.com') ? 'linkedin_lead' : 'web_search';
}

/**
 * Captures a role an officer found outside the automated run. This is a positive
 * recall example and a private lead, not a publication shortcut.
 */
export async function addMissedDiscoveryRole(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const employer = requiredFormText(formData, 'employer').slice(0, 500);
  const title = requiredFormText(formData, 'title').slice(0, 500);
  const reason = requiredFormText(formData, 'reason');
  const submittedUrl = requiredFormText(formData, 'url');
  const normalizedUrl = canonicalizeUrl(submittedUrl);
  if (!normalizedUrl || new URL(normalizedUrl).protocol !== 'https:') {
    throw new Error('Missed-role URL must be a valid HTTPS URL');
  }

  const route = manualDiscoveryRoute(normalizedUrl);
  const suppliedEmployerUrl = String(formData.get('employer_url') ?? '').trim();
  let canonicalEmployerUrl: string | null = null;
  if (suppliedEmployerUrl) {
    const validation = validateEmployerControlledSourceUrl(suppliedEmployerUrl);
    if (!validation.valid) throw new Error(validation.reason);
    canonicalEmployerUrl = validation.canonicalUrl;
  } else if (route !== 'linkedin_lead') {
    const validation = validateEmployerControlledSourceUrl(normalizedUrl);
    if (validation.valid) canonicalEmployerUrl = validation.canonicalUrl;
  }

  const resolution = resolveLead({
    originalUrl: normalizedUrl,
    canonicalEmployerUrl,
    originalRoute: route,
    originalReachable: true,
  });
  const now = new Date();
  const db = createServiceClient();
  const leadId = await archiveDiscoveryLead(db, {
    runId: `officer-missed:${now.toISOString().slice(0, 10)}:${randomUUID()}`,
    route,
    query: null,
    lane: null,
    originalUrl: normalizedUrl,
    normalizedUrl,
    visibleTitle: title,
    visibleSnippet: null,
    employerHint: employer,
    originalReachable: true,
    resolution: resolution.resolution,
    canonicalEmployerUrl: resolution.canonicalEmployerUrl,
    archiveReason: 'Officer supplied a role that the automated discovery run missed.',
    rawMetadata: {
      provider: 'officer_manual',
      discoveryBasis: 'missed_role',
      queryRoute: route,
      operatorProvided: true,
    },
    retrievedAt: now.toISOString(),
  });
  await recordDiscoveryFeedback(db, {
    leadId,
    decidedBy: user.id,
    label: 'relevant',
    reason,
    source: 'missed_role',
  });
  revalidatePath('/admin');
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/review');
}

/**
 * Approve guardrail lives in the UI (link opened + notes confirmed), but the
 * server enforces the hard parts: officer auth, a valid target status, and
 * that public_notes going live were explicitly provided by the officer.
 */
async function approveOpportunityUnsafe(input: {
  id: string;
  status: 'open_verified' | 'open_unverified';
  publicNotes: string;
  makeCompanyPublic: boolean;
  audienceBucket: AudienceBucket;
  audienceReason: string;
  graduateStage: GraduateStage;
  finalFields: ReviewFinalFields;
  sourceConfirmed: boolean;
  publicSafeConfirmed: boolean;
}): Promise<void> {
  const { user } = await requireOfficer();
  if (!['open_verified', 'open_unverified'].includes(input.status)) {
    throw new Error('Invalid target status');
  }
  if (!PUBLISHABLE_AUDIENCES.includes(input.audienceBucket)) {
    throw new Error('Only student-accessible records can be published');
  }
  if (!isPublishableAudienceStage(input.audienceBucket, input.graduateStage)) {
    throw new Error('Choose the student stage supported by the posting');
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
    .select('id')
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
      scientific_lanes: cleanControlledValues(input.finalFields.scientificLanes),
      job_functions: cleanControlledValues(input.finalFields.jobFunctions),
      methods: cleanControlledValues(input.finalFields.methods),
    },
    p_source_confirmed: input.sourceConfirmed,
    p_public_safe_confirmed: input.publicSafeConfirmed,
  });
  if (error) throw new Error(error.message);
  revalidatePublic();
}

export async function approveOpportunity(
  input: Parameters<typeof approveOpportunityUnsafe>[0],
): Promise<ReviewActionResult> {
  return runReviewAction('approve', input.id, () => approveOpportunityUnsafe(input));
}

async function archiveForAudienceUnsafe(input: {
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

export async function archiveForAudience(
  input: Parameters<typeof archiveForAudienceUnsafe>[0],
): Promise<ReviewActionResult> {
  return runReviewAction('archive', input.id, () => archiveForAudienceUnsafe(input));
}

async function rejectOpportunityUnsafe(id: string, reason: 'not_relevant' | 'hidden'): Promise<void> {
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

export async function rejectOpportunity(
  id: string,
  reason: 'not_relevant' | 'hidden',
): Promise<ReviewActionResult> {
  return runReviewAction('reject', id, () => rejectOpportunityUnsafe(id, reason));
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
