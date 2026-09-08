import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const path = new URL('../data/reviewed-opportunities.json', import.meta.url);
const payload = JSON.parse(await readFile(path, 'utf8'));

function normalizeCompany(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function validate(input) {
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

validate(payload);
if (!apply) {
  console.log(`Validated ${payload.opportunities.length} reviewed opportunities. Re-run with --apply to publish.`);
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.');
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let { data: source, error: sourceError } = await supabase
  .from('source_records')
  .select('id')
  .eq('name', payload.source.name)
  .limit(1)
  .maybeSingle();
if (sourceError) throw sourceError;
if (!source) {
  const inserted = await supabase.from('source_records').insert({
    name: payload.source.name,
    source_type: 'manual',
    owner: 'CSULB Biotechnology Club officers',
    access_level: 'public',
    canonical_status: 'current reviewed dataset',
    refresh_policy: 'Versioned GitHub review and automated Supabase sync',
    last_reviewed_at: `${payload.source.checked}T12:00:00Z`,
    public_safe: true,
  }).select('id').single();
  if (inserted.error) throw inserted.error;
  source = inserted.data;
}

let insertedCount = 0;
let updatedCount = 0;
for (const row of payload.opportunities) {
  const companyNormalized = normalizeCompany(row.company);
  const companyResult = await supabase.from('companies').upsert({
    name: row.company,
    name_normalized: companyNormalized,
    public_safe: true,
  }, { onConflict: 'name_normalized' }).select('id').single();
  if (companyResult.error) throw companyResult.error;

  const dedupeKey = `${companyNormalized}|${row.title.toLowerCase()}|${row.posting_url}`;
  const opportunity = {
    company_id: companyResult.data.id,
    source_record_id: source.id,
    title: row.title,
    posting_url: row.posting_url,
    location: row.location ?? null,
    eligibility: row.eligibility ?? null,
    focus_area: row.focus_area ?? null,
    deadline: row.deadline ?? null,
    deadline_text: row.deadline_text ?? null,
    start_date_text: row.start_date_text ?? null,
    paid_status: row.paid_status ?? 'unknown',
    application_type: 'Official employer posting',
    source_status_raw: row.status,
    status: row.status,
    public_notes: row.public_notes ?? null,
    private_notes: null,
    date_added: payload.source.checked,
    first_seen_at: `${payload.source.checked}T12:00:00Z`,
    last_seen_at: `${payload.source.checked}T12:00:00Z`,
    last_checked_at: `${payload.source.checked}T12:00:00Z`,
    relevance_score: row.relevance_score ?? null,
    relevance_reasons: [],
    review_status: 'approved',
    public_safe: true,
    dedupe_key: dedupeKey,
    family_key: null,
    audience_bucket: row.audience_bucket,
    audience_reason: row.audience_reason,
  };
  const existing = await supabase.from('opportunities').select('id').eq('dedupe_key', dedupeKey).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.[0]) {
    const update = await supabase.from('opportunities').update(opportunity).eq('id', existing.data[0].id);
    if (update.error) throw update.error;
    updatedCount += 1;
  } else {
    const insert = await supabase.from('opportunities').insert(opportunity);
    if (insert.error) throw insert.error;
    insertedCount += 1;
  }
}

console.log(`Published reviewed data: ${insertedCount} inserted, ${updatedCount} updated.`);
