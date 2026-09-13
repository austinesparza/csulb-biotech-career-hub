import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const queueAction = readFileSync('src/app/admin/sources/queue-actions.ts', 'utf8');
const queueForm = readFileSync('src/app/admin/sources/queue-drain-form.tsx', 'utf8');
const sourcesPage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');
const pipelineCycle = readFileSync('src/lib/pipeline-cycle.ts', 'utf8');

describe('source worker queue recovery', () => {
  it('requires an officer before invoking the shared pipeline', () => {
    expect(queueAction.indexOf('await requireOfficer()')).toBeLessThan(
      queueAction.indexOf('createServiceClient()'),
    );
    expect(queueAction).toContain('runPipelineCycle');
    expect(queueAction).toContain("trigger: 'queue_recovery'");
    expect(queueAction).toContain('scheduleDueSources: false');
  });

  it('uses the same ingest → reconcile → Sheet order as normal automation', () => {
    const runIndex = pipelineCycle.indexOf('reports.push(...await runIngestionBatch');
    const reconcileIndex = pipelineCycle.indexOf('...await reconcileReviewableSourcePostings');
    const sheetIndex = pipelineCycle.indexOf('...await syncReviewQueueToGoogleSheet');
    expect(runIndex).toBeGreaterThan(-1);
    expect(reconcileIndex).toBeGreaterThan(runIndex);
    expect(sheetIndex).toBeGreaterThan(reconcileIndex);
    expect(queueAction).not.toContain('decide_opportunity_review');
    expect(pipelineCycle).not.toContain('decide_opportunity_review');
  });

  it('surfaces stale pending work without creating duplicate source runs', () => {
    expect(sourcesPage).toContain('.eq("status", "pending")');
    expect(sourcesPage).toContain('The worker is behind');
    expect(sourcesPage).toContain('Advanced queue-only recovery');
    expect(sourcesPage).toContain('<QueueDrainForm pendingCount={pendingRuns.length} />');
    expect(queueForm).toContain('Process queued runs now');
    expect(queueForm).toContain('Queue is clear');
    expect(pipelineCycle).toContain('recover_stale_source_fetch_runs');
  });

  it('keeps automatic publication out of the recovery path', () => {
    expect(queueAction).toContain('Nothing was published automatically');
    expect(sourcesPage).toContain('Neither the scheduled nor manual pipeline can approve or publish an opportunity.');
  });
});
