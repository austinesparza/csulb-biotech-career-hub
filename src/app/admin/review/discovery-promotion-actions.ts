'use server';

import { revalidatePath } from 'next/cache';
import { quickAddOpportunity } from '@/app/admin/add/actions';
import { resolveDiscoveryPromotion } from '@/lib/discovery-promotion';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

function requiredId(formData: FormData): string {
  const id = String(formData.get('id') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid discovery lead ID');
  }
  return id;
}

async function closeLeadWorkflow(db: ReturnType<typeof createServiceClient>, id: string): Promise<void> {
  const now = new Date().toISOString();
  const { error: leadError } = await db.from('discovery_leads').update({
    officer_status: 'resolved',
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
    'An employer-controlled source was resolved automatically. Officer review of the full posting is still required before publication.',
    lead.latest_snippet?.trim() ? `Discovery snippet: ${lead.latest_snippet.trim()}` : null,
  ].filter(Boolean).join('\n'));

  await quickAddOpportunity(draft);
  await closeLeadWorkflow(db, id);
  return 'created';
}

/** Promote one verified discovery lead into the normal private opportunity queue. */
export async function promoteDiscoveryLeadToDraft(formData: FormData): Promise<void> {
  const id = requiredId(formData);
  await promoteDiscoveryLead(id);
  revalidatePath('/admin');
  revalidatePath('/admin/review');
}

/**
 * Promote every unresolved discovery lead that already has an employer-controlled
 * source. LinkedIn-only and unresolved leads remain private discovery records.
 */
export async function promoteAllVerifiedDiscoveryLeads(): Promise<void> {
  await requireOfficer();
  const db = createServiceClient();
  const { data, error } = await db.from('discovery_leads')
    .select('id')
    .eq('resolution', 'official_source_found')
    .in('officer_status', ['new', 'in_review'])
    .not('canonical_employer_url', 'is', null)
    .order('last_seen_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const failures: string[] = [];
  for (const row of data ?? []) {
    try {
      await promoteDiscoveryLead(row.id);
    } catch (error) {
      console.error('[discovery-promotion] lead failed', {
        leadId: row.id,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      failures.push(row.id);
    }
  }

  revalidatePath('/admin');
  revalidatePath('/admin/review');
  if (failures.length > 0) {
    throw new Error(`${failures.length} verified discovery lead(s) could not be promoted; the remaining leads stayed private.`);
  }
}
