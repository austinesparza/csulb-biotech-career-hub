import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cycle = readFileSync('src/lib/pipeline-cycle.ts', 'utf8');
const cron = readFileSync('src/app/api/cron/ingest/route.ts', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');
const migration = readFileSync('supabase/migrations/20260913054500_pipeline_cycle_observability_and_queue_recovery.sql', 'utf8');
const sheetWorkflow = readFileSync('src/app/admin/import/review-workflow-actions.ts', 'utf8');

describe('canonical pipeline orchestration', () => {
  it('keeps all normal pipeline stages in one ordered service', () => {
    const recover = cycle.indexOf("options.db.rpc('recover_stale_source_fetch_runs'");
    const schedule = cycle.indexOf("options.db.rpc('schedule_due_source_fetch_runs'");
    const ingest = cycle.indexOf('reports.push(...await runIngestionBatch');
    const reconcile = cycle.indexOf('...await reconcileReviewableSourcePostings');
    const sheet = cycle.indexOf('...await syncReviewQueueToGoogleSheet');

    expect(recover).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(recover);
    expect(ingest).toBeGreaterThan(schedule);
    expect(reconcile).toBeGreaterThan(ingest);
    expect(sheet).toBeGreaterThan(reconcile);
    expect(cycle).not.toContain('decide_opportunity_review');
  });

  it('routes scheduled automation through the same service', () => {
    expect(cron).toContain('runPipelineCycle');
    expect(cron).toContain("trigger: 'cron'");
    expect(cron).not.toContain('runIngestionBatch');
    expect(cron).not.toContain('syncReviewQueueToGoogleSheet');
  });

  it('keeps the production cron deployable on all Vercel plans while source intervals remain database-governed', () => {
    const config = JSON.parse(vercel) as { crons: Array<{ path: string; schedule: string }> };
    expect(config.crons.find((item) => item.path === '/api/cron/ingest')?.schedule).toBe('0 14 * * *');
    expect(cycle).toContain("options.db.rpc('schedule_due_source_fetch_runs'");
    expect(cycle).toContain("options.db.rpc('recover_stale_source_fetch_runs'");
  });

  it('records cycles and safely retries abandoned running work', () => {
    expect(migration).toContain('create table if not exists public.pipeline_cycles');
    expect(migration).toContain('idx_source_fetch_runs_one_active_per_source');
    expect(migration).toContain('recover_stale_source_fetch_runs');
    expect(migration).toContain("error_class = 'timeout'");
    expect(migration).toContain("'retry'");
    expect(migration).toContain('idx_opportunity_source_links_source_posting_id');
    expect(migration).toContain('idx_opportunities_source_record_id');
  });

  it('pulls officer edits before refreshing the Sheet', () => {
    const pull = sheetWorkflow.indexOf('await syncGoogleSheet()');
    const push = sheetWorkflow.indexOf('await reconcileAndSyncMachineReviewQueueToSheet()');
    expect(pull).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(pull);
    expect(sheetWorkflow).not.toContain('decide_opportunity_review');
  });
});
