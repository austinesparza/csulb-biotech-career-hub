import { describe, expect, it } from 'vitest';
import { deriveSheetAudienceDefaults, readSheetReviewIntent } from '../lib/sheet-review';

describe('officer spreadsheet review handoff', () => {
  it('turns evidence into private review defaults without publishing', () => {
    expect(deriveSheetAudienceDefaults({
      eligibility: "MBA, Master's, PharmD, or PhD; first program year completed before internship begins",
      keyEvidence: 'The official posting explicitly accepts graduate students.',
    })).toEqual({
      audienceBucket: 'graduate',
      audienceReason: 'The official posting explicitly accepts graduate students.',
      graduateStage: 'msc_year_2',
    });
  });

  it('preserves a Sheet approval as authenticated-review intent only', () => {
    expect(readSheetReviewIntent({
      'Publish Decision': 'Approve',
      'Public Safe?': true,
      'Graduate Access': 'Explicit',
      'Year / Program Requirement': "Master's or PhD students",
      'Key Evidence': "Posting explicitly names master's students.",
      Reviewer: 'Officer A',
    })).toEqual({
      decision: 'approve',
      publicSafe: true,
      audienceBucket: 'graduate',
      audienceReason: "Posting explicitly names master's students.",
      graduateStage: 'mixed_graduate',
      reviewer: 'Officer A',
    });
  });

  it('does not infer master\'s eligibility from doctoral-only language', () => {
    expect(deriveSheetAudienceDefaults({ eligibility: 'PhD candidates only' })).toMatchObject({
      audienceBucket: 'unknown',
      graduateStage: 'doctoral_only',
    });
  });
});
