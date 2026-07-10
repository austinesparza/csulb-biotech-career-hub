'use server';
// Quick-add: officer manually enters one posting. Same rules as import:
// requires the "Manual Officer Entry" source, lands as needs_review,
// dedupe-checked, never auto-public.
import { revalidatePath } from 'next/cache';
import { makeFamilyKey, makeStrictKey } from '@/lib/csvImport';
import { matchCompany, matchOpportunity, type ExistingOpportunity } from '@/lib/dedupe';
import { cleanText, normalizeCompanyName, normalizeUrl, parseDeadline, parsePaidStatus } from '@/lib/normalize';
import { scoreOpportunity } from '@/lib/relevance';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export interface QuickAddResult {
  id: string;
  duplicateWarning: string | null;
}

export async function quickAddOpportunity(formData: FormData): Promise<QuickAddResult> {
  await requireOfficer();
  const db = createServiceClient();

  const companyName = cleanText(formData.get('company') as string);
  const title = cleanText(formData.get('title') as string);
  if (!companyName || !title) throw new Error('Company and title are required.');

  const urlRaw = (formData.get('posting_url') as string) ?? '';
  const posting_url = urlRaw.trim() ? normalizeUrl(urlRaw) : null;
  if (urlRaw.trim() && !posting_url) throw new Error('That link is not a valid http(s) URL.');

  const deadlineRaw = (formData.get('deadline') as string) ?? '';
  const draft = {
    posting_url,
    location: cleanText(formData.get('location') as string),
    eligibility: cleanText(formData.get('eligibility') as string),
    focus_area: cleanText(formData.get('focus_area') as string),
    deadline: parseDeadline(deadlineRaw),
    deadline_text: cleanText(deadlineRaw),
    start_date_text: cleanText(formData.get('start_date_text') as string),
    paid_status: parsePaidStatus((formData.get('paid_status') as string) ?? ''),
    application_type: cleanText(formData.get('application_type') as string),
    public_notes: cleanText(formData.get('public_notes') as string),
    private_notes: cleanText(formData.get('private_notes') as string),
  };

  const sourceRecordId = (formData.get('source_record_id') as string) || null;
  if (!sourceRecordId) throw new Error('A source is required.');
  const { data: source } = await db
    .from('source_records')
    .select('id')
    .eq('id', sourceRecordId)
    .maybeSingle();
  if (!source) throw new Error('Unknown source record. Run seed.sql or create one first.');

  // Company: exact/fuzzy reuse, else create.
  const { data: companies } = await db.from('companies').select('id, name, name_normalized');
  const cMatch = matchCompany(companyName, companies ?? []);
  let companyId: string;
  if (cMatch.kind === 'none') {
    const { data: newCo, error } = await db
      .from('companies')
      .insert({ name: companyName, name_normalized: normalizeCompanyName(companyName) })
      .select('id')
      .single();
    if (error || !newCo) throw new Error(`Company insert failed: ${error?.message}`);
    companyId = newCo.id;
  } else {
    companyId = cMatch.companyId;
  }

  // Dedupe check before inserting.
  const dedupe_key = makeStrictKey(companyName, title, posting_url);
  const family_key = makeFamilyKey(companyName, title);
  const { data: existing } = await db
    .from('opportunities')
    .select('id, dedupe_key, family_key, posting_url, title, company_id, review_status, public_safe');
  const oMatch = matchOpportunity(
    { dedupe_key, family_key, posting_url, title, companyId },
    (existing ?? []) as ExistingOpportunity[],
  );
  if (oMatch.kind === 'same_url' || oMatch.kind === 'strict_key') {
    throw new Error('This posting already exists (same link or same company and title). Find it in the review queue or the board.');
  }

  const { score, reasons } = scoreOpportunity({ ...draft, focus_area: draft.focus_area });

  const { data: newOpp, error: oErr } = await db
    .from('opportunities')
    .insert({
      company_id: companyId,
      source_record_id: source.id,
      title,
      ...draft,
      status: 'needs_review',
      review_status: 'pending',
      public_safe: false,
      relevance_score: score,
      relevance_reasons: reasons,
      dedupe_key,
      family_key,
    })
    .select('id')
    .single();
  if (oErr || !newOpp) throw new Error(`Save failed: ${oErr?.message}`);

  let duplicateWarning: string | null = null;
  if (oMatch.kind === 'family' || oMatch.kind === 'fuzzy') {
    duplicateWarning = 'Saved, but it looks similar to an existing posting. A duplicate-check task was created.';
    await db.from('review_tasks').insert({
      task_type: oMatch.kind === 'family' ? 'possible_repost' : 'possible_duplicate',
      entity_table: 'opportunities',
      entity_id: newOpp.id,
      notes: `Quick-add similar to existing opportunity ${oMatch.opportunityId}.`,
    });
  }

  revalidatePath('/admin/review');
  return { id: newOpp.id, duplicateWarning };
}
