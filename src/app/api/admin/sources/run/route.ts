import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { googleSheetsConfigured } from '@/lib/google-sheets';
import { runClaimedFetch } from '@/lib/ingestion/source-runner';
import { syncReviewQueueToGoogleSheet } from '@/lib/review-sheet-sync';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sourcesUrl(request: Request, params: Record<string, string>): URL {
  const url = new URL('/admin/sources', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function POST(request: Request) {
  let runId: string | undefined;
  try {
    await requireOfficer();
    const formData = await request.formData();
    const id = String(formData.get('id') ?? '').trim();
    if (!id) throw new Error('Source ID is required.');

    const db = createServiceClient();
    const { data: source, error: sourceError } = await db.from('job_sources')
      .select('id, source_name, enabled, automatic_scheduling_paused_at')
      .eq('id', id)
      .maybeSingle();
    if (sourceError || !source) throw new Error('Source not found.');
    if (!source.enabled || source.automatic_scheduling_paused_at) {
      throw new Error('Enable and resume the source before running it.');
    }

    const now = new Date().toISOString();
    const { data: run, error: runError } = await db.from('source_fetch_runs').insert({
      job_source_id: id,
      trigger_kind: 'manual',
      status: 'running',
      scheduled_for: now,
      started_at: now,
      worker_id: `officer:${randomUUID()}`,
    }).select('id, job_source_id').single();
    if (runError || !run) throw new Error(`Could not start source run: ${runError?.message ?? 'unknown error'}`);
    runId = run.id;

    const report = await runClaimedFetch({ db, storage: db.storage, claim: run });
    if (report.status === 'failed') {
      return NextResponse.redirect(sourcesUrl(request, {
        operation: 'source_run',
        outcome: 'failed',
        run: report.fetchRunId,
      }), 303);
    }

    if (googleSheetsConfigured()) {
      await syncReviewQueueToGoogleSheet({ db });
    }

    return NextResponse.redirect(sourcesUrl(request, {
      operation: 'source_run',
      outcome: report.status,
      run: report.fetchRunId,
    }), 303);
  } catch (error) {
    console.error('[source-run] operator route failed', {
      runId: runId ?? null,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return NextResponse.redirect(sourcesUrl(request, {
      operation: 'source_run',
      outcome: 'error',
      ...(runId ? { run: runId } : {}),
    }), 303);
  }
}
