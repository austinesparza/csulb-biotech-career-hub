'use server';

import { revalidatePath } from 'next/cache';
import { quickAddOpportunity } from '@/app/admin/add/actions';
import {
  resolveDiscoveryPromotion,
  resolveVerifiedLinkedInPromotion,
  validateEmployerControlledSourceUrl,
} from '@/lib/discovery-promotion';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

function requiredId(formData: FormData): string {
  const id = String(formData.get('id') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid discovery lead ID');
  }
  return id;
}

async function ensureOpportunityReviewTask(
  db: ReturnType<typeof createServiceClient>,
  opportunityId: string,
  notes: string,
): Promise<void> {
  const { data: existing, error: existingError } = await db.from('review_tasks')
    .select('id')
    .eq('entity_table', 'opportunities')
    .eq('entity_id', opportunityId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return;

  const { error } = await db.from('review_tasks').insert({
    task_type: 'source_new',
    entity_table: 'opportunities',
    entity_id: opportunityId,
    status: 'open',
    priority: 100,
    notes,
  });
  if (error) throw new Error(error.message);
}

async function closeLeadWorkflow(
  db: ReturnType<typeof createServiceClient>,
  id: string,
  archiveReason?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error: leadError } = await db.from('discovery_leads').update({
    officer_status: 'resolved',
    ...(archiveReason ? { archive_reason: archiveReason } : {}),
    updated_at: now,
  }).eq('id', id).in('officer_status', ['new', 'in_review']);
  if (leadError) throw new Error(leadError.message);

  const { error: taskError } = await db.from('review_tasks').update({
    status: 'done',
    resolved_at: now,
  }).eq('entity_table', 'discovery_leads').eq('entity_id', id).in('status', ['open', 'in_progress']);
  if (taskError) throw new Error(taskError.message);
}

async function promoteDiscoveryLead(id: string): Promise<'created' | 'existing'> {
  await requireOfficer();
  const db = createServiceClient();
  const { data: lead, error: leadError } = await db.from('discovery_leads')
    .select('id, resolution, canonical_employer_url, employer_hint, latest_title, original_url, latest_snippet, officer_status')
    .eq('id', id)
    .single();
  if (leadError || !lead) throw new Error('Discovery lead not found');
  if (!['new', 'in_review'].includes(lead.officer_status)) throw new Error('Discovery lead is already resolved');

  const resolution = resolveDiscoveryPromotion({
    resolution: lead.resolution,
    canonicalEmployerUrl: lead.canonical_employer_url,
    employerHint: lead.employer_hint,
    title: lead.latest_title,
  });
  if (!resolution.ready) throw new Error(resolution.reason);

  const { data: existing, error: existingError } = await db.from('opportunities')
    .select('id')
    .eq('posting_url', resolution.canonicalUrl)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    await closeLeadWorkflow(db, id);
    return 'existing';
  }

  const { data: source, error: sourceError } = await db.from('source_records')
    .select('id')
    .eq('name', 'Manual Officer Entry')
    .limit(1)
    .maybeSingle();
  if (sourceError || !source) throw new Error('Manual Officer Entry source is missing');

  const draft = new FormData();
  draft.set('company', resolution.employer);
  draft.set('title', resolution.title);
  draft.set('posting_url', resolution.canonicalUrl);
  draft.set('source_record_id', source.id);
  draft.set('application_type', /co[ -]?op/i.test(resolution.title) ? 'Co-op' : 'Internship');
  draft.set('private_notes', [
    `Promoted from verified discovery lead ${lead.id}.`,
    `Discovery source: ${lead.original_url}`,
    'An employer-controlled source was resolved. Officer review of the full posting is still required before publication.',
    lead.latest_snippet?.trim() ? `Discovery snippet: ${lead.latest_snippet.trim()}` : null,
  ].filter(Boolean).join('\n'));

  const created = await quickAddOpportunity(draft);
  await ensureOpportunityReviewTask(
    db,
    created.id,
    'Promoted from a verified discovery lead with an employer-controlled posting; officer review required.',
  );
  await closeLeadWorkflow(db, id);
  return 'created';
}

/** Promote one verified discovery lead into the normal private opportunity queue. */
export async function promoteDiscoveryLeadToDraft(formData: FormData): Promise<void> {
  const id = requiredId(formData);
  if (String(formData.get('posting_confirmed') ?? '') !== 'on') {
    throw new Error('Confirm current Apply and the term and degree gates before creating a private draft');
  }
  await promoteDiscoveryLead(id);
  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

/**
 * Officer shortcut for the common LinkedIn/web-search handoff: paste the
 * employer-controlled career/ATS URL, attest provenance, and create the same
 * private review draft in one submission. It never publishes an opportunity.
 */
export async function resolveEmployerSourceAndPromote(formData: FormData): Promise<void> {
  await requireOfficer();
  const id = requiredId(formData);
  if (String(formData.get('source_confirmed') ?? '') !== 'on') {
    throw new Error('Confirm that the URL is controlled by the employer or its recruiting system');
  }

  const sourceResolution = validateEmployerControlledSourceUrl(
    String(formData.get('employer_url') ?? ''),
  );
  if (!sourceResolution.valid) throw new Error(sourceResolution.reason);

  const db = createServiceClient();
  const now = new Date().toISOString();
  const { data: updated, error } = await db.from('discovery_leads').update({
    canonical_employer_url: sourceResolution.canonicalUrl,
    resolution: 'official_source_found',
    archive_reason: 'Officer resolved an employer-controlled source. Lead is eligible for private opportunity review handoff.',
    updated_at: now,
  })
    .eq('id', id)
    .in('officer_status', ['new', 'in_review'])
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Discovery lead is no longer active; refresh the queue before retrying');

  await promoteDiscoveryLead(id);
  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

/**
 * Narrow exception for employers that use LinkedIn as the only role-specific
 * posting. An officer must verify both the first-party LinkedIn job and a
 * separate employer-controlled page supporting company/hiring provenance.
 * The result is still a private opportunity draft.
 */
export async function promoteVerifiedLinkedInLead(formData: FormData): Promise<void> {
  await requireOfficer();
  const id = requiredId(formData);
  if (String(formData.get('linkedin_confirmed') ?? '') !== 'on') {
    throw new Error('Confirm the first-party LinkedIn posting and employer-site evidence before promotion');
  }

  const db = createServiceClient();
  const { data: lead, error: leadError } = await db.from('discovery_leads')
    .select('id, resolution, employer_hint, latest_title, original_url, latest_snippet, officer_status')
    .eq('id', id)
    .single();
  if (leadError || !lead) throw new Error('Discovery lead not found');
  if (!['new', 'in_review'].includes(lead.officer_status)) throw new Error('Discovery lead is already resolved');

  const resolution = resolveVerifiedLinkedInPromotion({
    resolution: lead.resolution,
    originalUrl: lead.original_url,
    employerEvidenceUrl: String(formData.get('employer_evidence_url') ?? ''),
    employerHint: lead.employer_hint,
    title: lead.latest_title,
  });
  if (!resolution.ready) throw new Error(resolution.reason);

  const { data: existing, error: existingError } = await db.from('opportunities')
    .select('id')
    .eq('posting_url', resolution.postingUrl)
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    await closeLeadWorkflow(
      db,
      id,
      `Officer verified a first-party LinkedIn job posting with supporting employer-controlled evidence: ${resolution.employerEvidenceUrl}`,
    );
    return;
  }

  const { data: source, error: sourceError } = await db.from('source_records')
    .select('id')
    .eq('name', 'Manual Officer Entry')
    .limit(1)
    .maybeSingle();
  if (sourceError || !source) throw new Error('Manual Officer Entry source is missing');

  const draft = new FormData();
  draft.set('company', resolution.employer);
  draft.set('title', resolution.title);
  draft.set('posting_url', resolution.postingUrl);
  draft.set('source_record_id', source.id);
  draft.set('application_type', /co[ -]?op/i.test(resolution.title) ? 'Co-op' : 'Internship');
  draft.set('private_notes', [
    `Promoted from verified first-party LinkedIn discovery lead ${lead.id}.`,
    `LinkedIn posting: ${resolution.postingUrl}`,
    `Employer-controlled provenance evidence: ${resolution.employerEvidenceUrl}`,
    'Officer attested that the LinkedIn job was published by the employer and no role-specific employer/ATS posting was available. Final publication still requires normal officer review and public-safety approval.',
    lead.latest_snippet?.trim() ? `Discovery snippet: ${lead.latest_snippet.trim()}` : null,
  ].filter(Boolean).join('\n'));

  const created = await quickAddOpportunity(draft);
  await ensureOpportunityReviewTask(
    db,
    created.id,
    'Promoted through the verified first-party LinkedIn exception; officer review of eligibility and public fields required.',
  );
  await closeLeadWorkflow(
    db,
    id,
    `Officer verified a first-party LinkedIn job posting with supporting employer-controlled evidence: ${resolution.employerEvidenceUrl}`,
  );

  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

/**
 * Bulk promotion is disabled. An employer URL alone cannot establish current
 * availability or graduate access. Each lead requires an individual check.
 */
export async function promoteAllVerifiedDiscoveryLeads(): Promise<void> {
  await requireOfficer();
  throw new Error('Bulk promotion is disabled. Review each live employer posting and its gates individually.');
}
