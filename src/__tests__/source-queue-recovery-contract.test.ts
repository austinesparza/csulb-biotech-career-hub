import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const queueAction = readFileSync('src/app/admin/sources/queue-actions.ts', 'utf8');
const queueForm = readFileSync('src/app/admin/sources/queue-drain-form.tsx', 'utf8');
const sourcesPage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');

describe('source worker queue recovery', () => {
  it('requires an officer before claiming queued source runs', () => {
    expect(queueAction.indexOf('await requireOfficer()')).toBeLessThan(
      queueAction.indexOf('createServiceClient()'),
    );
    expect(queueAction).toContain('runIngestionBatch');
    expect(queueAction).toContain('workerId: `officer-queue:${randomUUID()}`');
  });

  it('reconciles review records and the Sheet after processing queued runs', () => {
    const runIndex = queueAction.indexOf('runIngestionBatch');
    const reconcileIndex = queueAction.indexOf('reconcileReviewableSourcePostings({ db, limit: 100 })');
    const sheetIndex = queueAction.indexOf('syncReviewQueueToGoogleSheet({ db, limit: 50 })');
    expect(runIndex).toBeGreaterThan(-1);
    expect(reconcileIndex).toBeGreaterThan(runIndex);
    expect(sheetIndex).toBeGreaterThan(reconcileIndex);
    expect(queueAction).not.toContain('decide_opportunity_review');
  });

  it('surfaces stale pending work without creating duplicate source runs', () => {
    expect(sourcesPage).toContain('.eq("status", "pending")');
    expect(sourcesPage).toContain('The scheduled worker appears behind');
    expect(sourcesPage).toContain('use the recovery control instead of creating duplicate source runs');
    expect(sourcesPage).toContain('<QueueDrainForm pendingCount={pendingRuns.length} />');
    expect(queueForm).toContain('Process queued runs now');
    expect(queueForm).toContain('Queue is clear');
  });

  it('keeps automatic publication out of the recovery path', () => {
    expect(queueAction).toContain('Nothing was published automatically');
    expect(sourcesPage).toContain('It does not schedule extra fetches or publish opportunities.');
  });
});
