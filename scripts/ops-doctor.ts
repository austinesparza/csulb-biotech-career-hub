#!/usr/bin/env node

import { loadEnvConfig } from '@next/env';
import { createClient } from '@supabase/supabase-js';
import { fetchGoogleSheet, googleSheetsConfigured, readGoogleSheetsConfig } from '../src/lib/google-sheets';
import { assertPrivilegedRuntimeAllowed } from '../src/lib/supabase/runtime-safety';

loadEnvConfig(process.cwd());

type CheckState = 'PASS' | 'FAIL' | 'WARN';
let failures = 0;

function report(state: CheckState, label: string, detail: string): void {
  if (state === 'FAIL') failures++;
  console.log(`${state.padEnd(4)}  ${label}: ${detail}`);
}

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function requireEnvironment(names: string[]): boolean {
  const missing = names.filter((name) => !present(name));
  if (missing.length) {
    report('FAIL', 'environment', `missing ${missing.join(', ')}`);
    return false;
  }
  report('PASS', 'environment', 'required server configuration is present');
  return true;
}

async function checkDatabase(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const relations = [
    'officers',
    'source_records',
    'import_runs',
    'raw_import_rows',
    'opportunities',
    'review_tasks',
    'source_fetch_runs',
    'source_payloads',
    'source_posting_versions',
    'pipeline_extractions',
    'discovery_leads',
    'discovery_lead_observations',
    'public_opportunities',
  ];
  const results = await Promise.all(relations.map(async (relation) => {
    const { error } = await db.from(relation).select('*', { count: 'exact', head: true });
    return { relation, error };
  }));
  const unavailable = results.filter(({ error }) => error).map(({ relation }) => relation);
  if (unavailable.length) {
    report('FAIL', 'database schema', `unavailable relations: ${unavailable.join(', ')}`);
    return;
  }
  report('PASS', 'database schema', 'ingestion, review, archive, and public-view relations are reachable');
}

async function checkDiscovery(): Promise<void> {
  if (process.env.DISCOVERY_SEARCH_ENABLED !== 'true') {
    report('FAIL', 'search discovery', 'disabled; automated searches are not running');
    return;
  }
  const missing = ['BRAVE_SEARCH_API_KEY', 'BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED']
    .filter((name) => name === 'BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED'
      ? process.env[name] !== 'true'
      : !present(name));
  if (missing.length) {
    report('FAIL', 'search discovery', `missing required provider configuration: ${missing.join(', ')}`);
    return;
  }
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await db.from('pipeline_cycles')
    .select('discovery_json')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    report('FAIL', 'search discovery', 'could not verify recent discovery cycles');
    return;
  }
  const completed = (data ?? []).filter((row) => row.discovery_json?.status === 'completed');
  if (completed.length === 0) {
    report('FAIL', 'search discovery', 'no completed discovery cycle in the last seven days');
    return;
  }
  report('PASS', 'search discovery', `${completed.length} completed cycle(s) in the last seven days`);
}

async function checkSheet(): Promise<void> {
  if (!googleSheetsConfigured()) {
    report('FAIL', 'Google Sheet', 'read-only Sheet configuration is incomplete');
    return;
  }
  const config = readGoogleSheetsConfig();
  const snapshot = await fetchGoogleSheet(config);
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: source, error } = await db.from('source_records').select('id').eq('id', config.sourceRecordId).maybeSingle();
  if (error || !source) {
    report('FAIL', 'Sheet provenance', 'configured source record is missing');
    return;
  }
  report('PASS', 'Google Sheet', `${snapshot.rowCount} data rows are readable from the bounded range`);
  report('PASS', 'Sheet provenance', 'the fixed database source record exists');
}

async function main(): Promise<void> {
  console.log('CSULB Career Hub operational readiness\n');
  try {
    assertPrivilegedRuntimeAllowed();
    report('PASS', 'preview isolation', process.env.VERCEL_ENV === 'preview'
      ? 'preview contains no privileged database key'
      : 'runtime is not a privileged Vercel preview');
  } catch (error) {
    report('FAIL', 'preview isolation', error instanceof Error ? error.message : 'unsafe preview configuration');
  }

  const environmentReady = requireEnvironment([
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
    'GOOGLE_SHEETS_SPREADSHEET_ID',
    'GOOGLE_SHEETS_RANGE',
    'GOOGLE_SHEETS_SOURCE_RECORD_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ]);

  if (environmentReady) {
    try {
      await checkDatabase();
    } catch {
      report('FAIL', 'database connection', 'could not reach the configured project');
    }
    try {
      await checkDiscovery();
    } catch {
      report('FAIL', 'search discovery', 'could not check discovery readiness');
    }
    try {
      await checkSheet();
    } catch (error) {
      report('FAIL', 'Google Sheet', error instanceof Error ? error.message : 'readiness check failed');
    }
  }

  if (!present('PIPELINE_MODEL_ENABLED') || process.env.PIPELINE_MODEL_ENABLED !== 'true') {
    report('WARN', 'model extraction', 'disabled, deterministic intake and officer review remain available');
  } else {
    report('PASS', 'model extraction', 'enabled');
  }

  console.log(`\n${failures ? `${failures} blocking check(s) failed.` : 'All blocking checks passed.'}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(() => {
  report('FAIL', 'readiness check', 'unexpected failure');
  process.exitCode = 1;
});
