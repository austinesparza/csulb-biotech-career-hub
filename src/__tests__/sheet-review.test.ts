import { describe, expect, it } from 'vitest';
import { deriveSheetAudienceDefaults, filterMeaningfulReviewRows, readSheetReviewIntent } from '../lib/sheet-review';

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

  it('classifies undergraduate, post-baccalaureate, and master\'s access as mixed', () => {
    expect(deriveSheetAudienceDefaults({
      eligibility: "Current undergraduate, post-baccalaureate, or master's student",
    })).toMatchObject({
      audienceBucket: 'mixed',
      graduateStage: 'graduate_unspecified',
    });
  });

  it('drops unused checkbox template rows but retains partial candidates', () => {
    const rows = [
      ['Candidate ID', 'Employer', 'Role Title', 'Source URL', 'Public Safe?'],
      ['', '', '', '', 'FALSE'],
      ['CAND-1', 'Example Bio', '', '', 'FALSE'],
      ['', 'Example Lab', 'Research Intern', 'https://example.org/job', 'FALSE'],
    ];
    expect(filterMeaningfulReviewRows(rows)).toEqual({
      rows: [rows[0], rows[2], rows[3]],
      candidateRows: 2,
      skippedTemplateRows: 1,
    });
  });
});
