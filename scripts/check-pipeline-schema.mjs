import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort();
const failures = [];

const prefixes = new Map();
for (const file of files) {
  const prefix = file.match(/^(\d+)_/)?.[1];
  if (!prefix) failures.push(`${file}: missing numeric migration prefix`);
  else if (prefixes.has(prefix)) failures.push(`${file}: duplicate prefix ${prefix} also used by ${prefixes.get(prefix)}`);
  else prefixes.set(prefix, file);
}

const sql = files.map((file) => fs.readFileSync(path.join(migrationsDir, file), 'utf8')).join('\n');
const duplicatePipelineTables = [
  'sources', 'source_fetches', 'raw_documents', 'candidates',
  'review_queue', 'published_opportunities', 'submissions', 'opportunity_drafts',
];

for (const table of duplicatePipelineTables) {
  const pattern = new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${table}\\b`, 'i');
  if (pattern.test(sql)) failures.push(`executable migrations recreate parallel table ${table}`);
}

if (/create\s+extension(?:\s+if\s+not\s+exists)?\s+vector\b/i.test(sql)) {
  failures.push('pgvector is executable before the retrieval benchmark gate');
}
if (!/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.pipeline_extractions\b/i.test(sql)) {
  failures.push('pipeline_extractions integration table is missing');
}
if (!/create\s+or\s+replace\s+function\s+public\.decide_opportunity_review\b/i.test(sql)) {
  failures.push('atomic review decision RPC is missing');
}
if (!/create\s+or\s+replace\s+function\s+public\.pending_pipeline_extractions\b/i.test(sql)) {
  failures.push('prompt-version-aware extraction inbox RPC is missing');
}
if (/alter\s+type\s+public\.task_type\s+add\s+value[^;]+extraction_review/i.test(sql)) {
  failures.push('extraction must reuse canonical review task types');
}
if (!/drop\s+policy\s+if\s+exists\s+anon_insert_submissions/i.test(sql)
    || !/revoke\s+insert\s+on\s+public\.user_submissions\s+from\s+anon/i.test(sql)) {
  failures.push('anonymous submission table insert must be revoked by a later migration');
}
if (!/create\s+or\s+replace\s+function\s+public\.accept_public_submission/i.test(sql)) {
  failures.push('bounded public submission RPC is missing');
}
if (!/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.discovery_leads\b/i.test(sql)
    || !/create\s+table(?:\s+if\s+not\s+exists)?\s+public\.discovery_lead_observations\b/i.test(sql)) {
  failures.push('private lossless discovery-lead archive is missing');
}
if (!/create\s+or\s+replace\s+function\s+public\.archive_discovery_lead/i.test(sql)) {
  failures.push('service-only discovery lead archive RPC is missing');
}
if (!/set\s+graduate_stage\s*=\s*'graduate_unspecified'/i.test(sql)) {
  failures.push('graduate-stage backfill is missing');
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`ok  ${files.length} executable migrations, no parallel pipeline schema`);
