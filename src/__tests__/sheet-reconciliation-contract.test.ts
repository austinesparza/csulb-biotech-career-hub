import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reconcile = readFileSync('src/lib/ingestion/persistence/reconcile-reviewable.ts', 'utf8');
const action = readFileSync('src/app/admin/import/sheet-reconcile-actions.ts', 'utf8');
const ui = readFileSync('src/app/admin/import/sheet-sync.tsx', 'utf8');
const bridge = readFileSync('src/lib/ingestion/persistence/opportunity-bridge.ts', 'utf8');

describe('Review Queue source reconciliation contract', () => {
  it('treats canonical URL identity as the materialization boundary', () => {
    expect(reconcile).toContain('hasExactMaterialization');
    expect(reconcile).toContain('normalizeUrl(opportunityUrl) === normalizedPostingUrl');
    expect(reconcile).toContain(".gte('relevance_score', PENDING_OPPORTUNITY_MIN_SCORE)");
  });

  it('repairs the source backlog before writing the Sheet', () => {
    const reconcileIndex = action.indexOf('reconcileReviewableSourcePostings({ db })');
    const syncIndex = action.indexOf('syncReviewQueueToGoogleSheet({ db })');
    expect(reconcileIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(reconcileIndex);
  });

  it('keeps family and fuzzy matches as review signals rather than merge proof', () => {
    expect(bridge).toContain("match.kind === 'family' || match.kind === 'fuzzy'");
    expect(bridge).toContain('The new source remains linked to its own draft.');
  });

  it('explains an empty queue instead of presenting zero as a failed sync', () => {
    expect(ui).toContain('No unresolved machine candidates remain.');
    expect(ui).toContain('Previously resolved machine rows are retained in the Sheet Archive tab.');
    expect(ui).toContain('bridge gaps found');
  });
});
