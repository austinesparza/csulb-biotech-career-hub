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
    });

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
    });

    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/not approve/i);
  });
});
