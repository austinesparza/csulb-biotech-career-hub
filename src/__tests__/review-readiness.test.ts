import { describe, expect, it } from 'vitest';

import { reviewReadinessBucket } from '../lib/review-readiness';

describe('reviewReadinessBucket', () => {
  it('puts a structured mixed-audience posting in the decision-ready group', () => {
    expect(reviewReadinessBucket({
      postingUrl: 'https://example.org/jobs/1',
      audienceBucket: 'mixed',
      audienceReason: "Official posting accepts bachelor's and master's students.",
      graduateStage: 'msc_any',
    })).toBe('decision-ready');
  });

  it('keeps an unknown degree audience in eligibility confirmation', () => {
    expect(reviewReadinessBucket({
      postingUrl: 'https://example.org/jobs/2',
      audienceBucket: 'unknown',
      audienceReason: 'Posting says currently enrolled but does not state degree level.',
      graduateStage: 'unknown',
    })).toBe('needs-confirmation');
  });

  it('keeps incomplete audience evidence in eligibility confirmation', () => {
    expect(reviewReadinessBucket({
      postingUrl: 'https://example.org/jobs/3',
      audienceBucket: 'graduate',
      audienceReason: null,
      graduateStage: 'msc_any',
    })).toBe('needs-confirmation');
  });

  it('routes special-affiliation records outside the public board', () => {
    expect(reviewReadinessBucket({
      postingUrl: 'https://example.org/jobs/4',
      audienceBucket: 'special',
      audienceReason: 'Open only to students at a named partner institution.',
      graduateStage: 'msc_any',
    })).toBe('outside-board');
  });

  it('treats an undergraduate-only student posting as decision-ready', () => {
    expect(reviewReadinessBucket({
      postingUrl: 'https://example.org/jobs/5',
      audienceBucket: 'undergraduate',
      audienceReason: 'Official posting requires current undergraduate enrollment.',
      graduateStage: 'not_msc',
    })).toBe('decision-ready');
  });
});
