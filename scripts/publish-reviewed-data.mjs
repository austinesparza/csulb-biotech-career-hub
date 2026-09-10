import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export function normalizeCompany(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function validate(input) {
  if (!input.source?.name || !/^\d{4}-\d{2}-\d{2}$/.test(input.source?.checked ?? '')) {
    throw new Error('Source name and ISO checked date are required.');
  }
  const allowedAudience = new Set(['undergraduate', 'graduate', 'mixed', 'special', 'adjacent', 'ineligible']);
  for (const [index, row] of input.opportunities.entries()) {
    for (const field of ['company', 'title', 'posting_url', 'status', 'audience_bucket', 'audience_reason']) {
      if (!row[field]) throw new Error(`Row ${index + 1} is missing ${field}.`);
    }
    if (!allowedAudience.has(row.audience_bucket)) throw new Error(`Row ${index + 1} has an invalid audience bucket.`);
    if (!/^https:\/\//.test(row.posting_url)) throw new Error(`Row ${index + 1} needs an HTTPS source.`);
  }
}

const MATERIAL_FIELDS = [
  'title', 'posting_url', 'location', 'eligibility', 'focus_area', 'deadline', 'deadline_text',
  'start_date_text', 'paid_status', 'source_status_raw', 'public_notes', 'audience_bucket', 'audience_reason',
];

export function materialDiff(existing, proposed) {
  return MATERIAL_FIELDS.filter((field) => (existing[field] ?? null) !== (proposed[field] ?? null));
}

async function loadPayload() {
  const path = new URL('../data/reviewed-opportunities.json', import.meta.url);
  return JSON.parse(await readFile(path, 'utf8'));
}

async function applyPayload(payload) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let { data: source, error: sourceError } = await supabase.from('source_records').select('id')
    .eq('name', payload.source.name).limit(1).maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) {
    const inserted = await supabase.from('source_records').insert({
      name: payload.source.name, source_type: 'manual', owner: 'CSULB Biotechnology Club officers',
      access_level: 'public', canonical_status: 'reviewed Git dataset',
      refresh_policy: 'Versioned GitHub staging; officer approval in the admin queue',
      last_reviewed_at: `${payload.source.checked}T12:00:00Z`, public_safe: true,
    }).select('id').single();
    if (inserted.error) throw inserted.error;
    source = inserted.data;
  }

  let staged = 0;
  let changed = 0;
  let unchanged = 0;
  for (const row of payload.opportunities) {
    const companyNormalized = normalizeCompany(row.company);
    const companyResult = await supabase.from('companies').upsert({
      name: row.company, name_normalized: companyNormalized,
    }, { onConflict: 'name_normalized' }).select('id').single();
    if (companyResult.error) throw companyResult.error;

    const dedupeKey = `${companyNormalized}|${row.title.toLowerCase()}|${row.posting_url}`;
    const proposed = {
      company_id: companyResult.data.id, source_record_id: source.id, title: row.title,
      posting_url: row.posting_url, location: row.location ?? null, eligibility: row.eligibility ?? null,
      focus_area: row.focus_area ?? null, deadline: row.deadline ?? null,
      deadline_text: row.deadline_text ?? null, start_date_text: row.start_date_text ?? null,
      paid_status: row.paid_status ?? 'unknown', application_type: 'Official employer posting',
      source_status_raw: row.status, public_notes: row.public_notes ?? null,
      audience_bucket: row.audience_bucket, audience_reason: row.audience_reason,
    };
    const existing = await supabase.from('opportunities').select('*').eq('dedupe_key', dedupeKey).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) {
      const fields = materialDiff(existing.data, proposed);
      if (fields.length) {
        const task = await supabase.from('review_tasks').insert({
          task_type: 'import_changed', entity_table: 'opportunities', entity_id: existing.data.id,
          notes: `Git-reviewed dataset differs in: ${fields.join(', ')}. Compare before changing the published record.`,
        });
        if (task.error && task.error.code !== '23505') throw task.error;
        changed += 1;
      } else {
        const seen = await supabase.from('opportunities').update({
          last_seen_at: `${payload.source.checked}T12:00:00Z`,
          last_checked_at: `${payload.source.checked}T12:00:00Z`,
        }).eq('id', existing.data.id);
        if (seen.error) throw seen.error;
        unchanged += 1;
      }
      continue;
    }

    const insert = await supabase.from('opportunities').insert({
      ...proposed, private_notes: 'Staged from the versioned reviewed dataset; officer approval required.',
      date_added: payload.source.checked, first_seen_at: `${payload.source.checked}T12:00:00Z`,
      last_seen_at: `${payload.source.checked}T12:00:00Z`, last_checked_at: `${payload.source.checked}T12:00:00Z`,
      relevance_score: row.relevance_score ?? null, relevance_reasons: [], status: 'needs_review',
      review_status: 'pending', public_safe: false, graduate_stage: 'unknown', eligibility_status: 'unknown',
      dedupe_key: dedupeKey, family_key: null,
    });
    if (insert.error) throw insert.error;
    staged += 1;
  }
  console.log(`Staged reviewed data: ${staged} new drafts, ${changed} change tasks, ${unchanged} unchanged.`);
}

export async function main() {
  const payload = await loadPayload();
  validate(payload);
  if (!process.argv.includes('--apply')) {
    console.log(`Validated ${payload.opportunities.length} reviewed opportunities. Re-run with --apply to stage for officer review.`);
    return;
  }
  await applyPayload(payload);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
