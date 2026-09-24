import { describe, expect, it } from 'vitest';

import { resolveSheetPublishCandidate } from '../lib/review-publish';
import type { SheetReviewIntent } from '../lib/sheet-review';

function sheet(overrides: Partial<SheetReviewIntent> = {}): SheetReviewIntent {
  return {
    decision: 'approve',
    publicSafe: true,
    reviewer: 'Officer',
    audienceBucket: 'graduate',
    audienceReason: "Official posting accepts students enrolled in a master's program.",
    graduateStage: 'msc_any',
    ...overrides,
  };
}

describe('resolveSheetPublishCandidate', () => {
  it('uses governed Sheet defaults when the private draft is still unknown', () => {
    const result = resolveSheetPublishCandidate({
      postingUrl: 'https://example.org/jobs/1',
      audienceBucket: 'unknown',
      audienceReason: null,
      graduateStage: 'unknown',
      sheetReview: sheet(),
      sourceCheckResult: 'open', lastCheckedAt: '2026-09-24T12:00:00Z',
    }, new Date('2026-09-24T13:00:00Z'));

    expect(result).toEqual({
      ready: true,
      audienceBucket: 'graduate',
      audienceReason: "Official posting accepts students enrolled in a master's program.",
      graduateStage: 'msc_any',
    });
  });

  it('blocks a special-affiliation role even when the Sheet says approve', () => {
    const result = resolveSheetPublishCandidate({
      postingUrl: 'https://example.org/jobs/2',
      audienceBucket: 'special',
      audienceReason: 'Open only to current Northeastern University co-op students.',
      graduateStage: 'msc_any',
      sheetReview: sheet(),
      sourceCheckResult: 'open', lastCheckedAt: new Date().toISOString(),
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/not eligible/i);
  });

  it('requires the explicit Public Safe Sheet control', () => {
    const result = resolveSheetPublishCandidate({
      postingUrl: 'https://example.org/jobs/3',
      audienceBucket: 'graduate',
      audienceReason: "Master's students are eligible.",
      graduateStage: 'msc_any',
      sheetReview: sheet({ publicSafe: false }),
      sourceCheckResult: 'open', lastCheckedAt: new Date().toISOString(),
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/public safe/i);
  });

  it('does not treat a Sheet rejection as publishable intent', () => {
    const result = resolveSheetPublishCandidate({
      postingUrl: 'https://example.org/jobs/4',
      audienceBucket: 'graduate',
      audienceReason: "Master's students are eligible.",
      graduateStage: 'msc_any',
      sheetReview: sheet({ decision: 'reject' }),
      sourceCheckResult: 'open', lastCheckedAt: new Date().toISOString(),
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/not approve/i);
  });

  it('blocks Sheet approval when the opening is unknown, stale, or not positively checked', () => {
    const input = {
      postingUrl: 'https://example.org/jobs/5',
      audienceBucket: 'graduate' as const,
      audienceReason: "Official posting accepts master's students.",
      graduateStage: 'msc_any' as const,
      sheetReview: sheet(),
      sourceCheckResult: 'unknown',
      lastCheckedAt: '2026-09-24T12:00:00Z',
    };
    const now = new Date('2026-09-24T13:00:00Z');
    for (const record of [input, { ...input, sourceCheckResult: 'open', lastCheckedAt: '2026-09-01T12:00:00Z' }]) {
      const result = resolveSheetPublishCandidate(record, now);
      expect(result.ready).toBe(false);
      if (!result.ready) expect(result.reason).toMatch(/source check/i);
    }
  });

  it('never bulk publishes a LinkedIn-only lead as a verified employer opening', () => {
    const result = resolveSheetPublishCandidate({
      postingUrl: 'https://www.linkedin.com/jobs/view/123',
      audienceBucket: 'graduate',
      audienceReason: "Posting accepts master's students.",
      graduateStage: 'msc_any',
      sheetReview: sheet(),
      sourceCheckResult: 'open', lastCheckedAt: new Date().toISOString(),
    });
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/LinkedIn/i);
  });
});
