import { randomUUID } from 'node:crypto';

import { runClaimedFetch } from '../src/lib/ingestion/source-runner';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

async function main(): Promise<void> {
  const identifier = process.env.SOURCE_IDENTIFIER?.trim();
  if (!identifier) throw new Error('SOURCE_IDENTIFIER is required');

  const db = createPipelineServiceClient();
  const { data: source, error: sourceError } = await db.from('job_sources')
    .select('id, source_name, source_identifier, terms_reviewed, terms_review_date, robots_reviewed')
    .eq('source_identifier', identifier)
    .maybeSingle();
  if (sourceError) throw new Error(`Could not load source: ${sourceError.message}`);
  if (!source) throw new Error(`Source ${identifier} was not found`);
  if (!source.terms_reviewed || !source.terms_review_date || !source.robots_reviewed) {
    throw new Error('Source governance review is incomplete');
  }

  const now = new Date().toISOString();
  const { data: run, error: runError } = await db.from('source_fetch_runs').insert({
    job_source_id: source.id,
    trigger_kind: 'manual',
    status: 'running',
    scheduled_for: now,
    started_at: now,
    worker_id: `github-private-test:${process.env.GITHUB_RUN_ID?.trim() || randomUUID()}`,
    log_json: { privateTest: true, sourceIdentifier: identifier },
  }).select('id, job_source_id').single();
  if (runError || !run) {
    throw new Error(`Could not start private source test: ${runError?.message ?? 'unknown error'}`);
  }

  const report = await runClaimedFetch({
    db,
    storage: db.storage,
    claim: run,
    privateTest: true,
  });

  console.log(JSON.stringify({
    sourceId: source.id,
    sourceName: source.source_name,
    sourceIdentifier: identifier,
    runId: report.fetchRunId,
    status: report.status,
    recordsSeen: report.recordsSeen,
    recordsArchived: report.recordsArchived,
    reviewTasksCreated: report.reviewTasksCreated,
    error: report.error,
    warnings: report.warnings,
  }));

  if (report.status === 'failed') process.exitCode = 1;
}

main().catch((error) => {
  console.error('[private-source-test] failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
