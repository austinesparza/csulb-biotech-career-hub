import { randomUUID } from 'node:crypto';

import { runClaimedFetch } from '../src/lib/ingestion/source-runner';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

const MAX_TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_ERROR_PATTERN = /gateway timeout|bad gateway|service unavailable|request timeout|timed?\s*out|timeout|fetch failed|network error|\b50[234]\b/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTransientError(error: unknown): boolean {
  return TRANSIENT_ERROR_PATTERN.test(errorMessage(error));
}

async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
}

async function main(): Promise<void> {
  const identifier = process.env.SOURCE_IDENTIFIER?.trim();
  if (!identifier) throw new Error('SOURCE_IDENTIFIER is required');

  const db = createPipelineServiceClient();
  let source: {
    id: string;
    source_name: string;
    source_identifier: string;
    terms_reviewed: boolean;
    terms_review_date: string | null;
    robots_reviewed: boolean;
  } | null = null;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    const { data, error } = await db.from('job_sources')
      .select('id, source_name, source_identifier, terms_reviewed, terms_review_date, robots_reviewed')
      .eq('source_identifier', identifier)
      .maybeSingle();
    if (!error) {
      source = data;
      break;
    }
    if (attempt >= MAX_TRANSIENT_ATTEMPTS || !isTransientError(error.message)) {
      throw new Error(`Could not load source: ${error.message}`);
    }
    console.warn('[private-source-test] transient source lookup failure; retrying', {
      attempt,
      error: error.message,
    });
    await waitBeforeRetry(attempt);
  }

  if (!source) throw new Error(`Source ${identifier} was not found`);
  if (!source.terms_reviewed || !source.terms_review_date || !source.robots_reviewed) {
    throw new Error('Source governance review is incomplete');
  }

  let report: Awaited<ReturnType<typeof runClaimedFetch>> | null = null;
  let lastTransientError: unknown = null;

  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const now = new Date().toISOString();
      const workflowRunId = process.env.GITHUB_RUN_ID?.trim() || randomUUID();
      const workflowAttempt = process.env.GITHUB_RUN_ATTEMPT?.trim() || '1';
      const { data: run, error: runError } = await db.from('source_fetch_runs').insert({
        job_source_id: source.id,
        trigger_kind: 'manual',
        status: 'running',
        scheduled_for: now,
        started_at: now,
        worker_id: `github-private-test:${workflowRunId}:${workflowAttempt}:${attempt}`,
        log_json: { privateTest: true, sourceIdentifier: identifier, transientAttempt: attempt },
      }).select('id, job_source_id').single();
      if (runError || !run) {
        throw new Error(`Could not start private source test: ${runError?.message ?? 'unknown error'}`);
      }

      report = await runClaimedFetch({
        db,
        storage: db.storage,
        claim: run,
        privateTest: true,
      });

      if (report.status === 'failed' && isTransientError(report.error ?? '')) {
        throw new Error(report.error ?? 'Transient private source test failure');
      }
      break;
    } catch (error) {
      lastTransientError = error;
      if (attempt >= MAX_TRANSIENT_ATTEMPTS || !isTransientError(error)) throw error;
      console.warn('[private-source-test] transient execution failure; retrying', {
        attempt,
        error: errorMessage(error),
      });
      await waitBeforeRetry(attempt);
    }
  }

  if (!report) {
    throw new Error(`Private source test exhausted retries: ${errorMessage(lastTransientError)}`);
  }

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
    error: errorMessage(error),
  });
  process.exitCode = 1;
});
