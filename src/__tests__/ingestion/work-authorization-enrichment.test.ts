import { describe, expect, it } from 'vitest';

import { deriveOpportunityEnrichment } from '../../lib/ingestion/persistence/opportunity-bridge';
import type { NormalizedSourcePosting } from '../../lib/ingestion/types';

function posting(descriptionText: string): NormalizedSourcePosting {
  return {
    identityKey: 'greenhouse:work-auth:1', materialHash: 'b'.repeat(64), connectorVersion: 'test',
    sourceKind: 'greenhouse', externalPostingId: '1', internalJobId: null, requisitionId: null,
    employerNameRaw: 'Test Biotech', employerNameNormalized: 'test biotech',
    titleRaw: 'Genomics Intern', titleNormalized: 'genomics intern',
    locationRaw: 'Cambridge, MA', locationNormalized: 'cambridge ma',
    canonicalUrl: 'https://example.org/jobs/1', remoteType: 'onsite', employmentType: 'Internship',
    classification: 'internship', department: 'Research', departments: ['Research'], offices: ['Cambridge, MA'],
    focusArea: 'Genomics and genetics', postedAt: '2026-09-01', closesAt: null, deadlineKind: 'unknown',
    descriptionText, language: 'en', sourceUpdatedAt: '2026-09-01T00:00:00Z', sourceMetadata: null,
    relevanceScore: 95, relevanceScoreVersion: 4,
    scoreBreakdown: { version: 4, total: 95, rawTotal: 95, positiveReasons: [], negativeReasons: [], uncertaintyFlags: [] },
    uncertaintyFlags: [], fetchedAt: '2026-09-13T17:00:00Z',
  };
}

describe('work authorization evidence extraction', () => {
  it('does not treat EEO citizenship language as work authorization', () => {
    const result = deriveOpportunityEnrichment(posting(
      "Bachelor's or master's students may apply. Equal employment opportunity applies regardless of race, religion, national origin, age, citizenship, disability, or veteran status.",
    ));
    expect(result.workAuthorization).toBeNull();
  });

  it('does not treat privacy opt-out language as OPT authorization', () => {
    const result = deriveOpportunityEnrichment(posting(
      "Bachelor's or master's students may apply. California residents may opt out of sharing personal information under the CCPA/CPRA.",
    ));
    expect(result.workAuthorization).toBeNull();
  });

  it('ignores the exact combined EEO and privacy boilerplate pattern from Flagship postings', () => {
    const result = deriveOpportunityEnrichment(posting(
      'This position is open exclusively to current Northeastern University Co-Op students. Equal employment opportunity applies regardless of age, citizenship, disability, or veteran status. California residents may opt out of sharing personal information.',
    ));
    expect(result.workAuthorization).toBeNull();
  });

  it('captures explicit U.S. work authorization and sponsorship language', () => {
    const result = deriveOpportunityEnrichment(posting(
      "Applicants must be authorized to work in the U.S. without visa sponsorship. Master's students are welcome.",
    ));
    expect(result.workAuthorization).toContain('authorized to work');
    expect(result.workAuthorization).toContain('visa sponsorship');
  });

  it('captures CPT or OPT only in employment-authorization context', () => {
    const result = deriveOpportunityEnrichment(posting(
      'F-1 students are eligible for CPT/OPT employment authorization for this internship. Undergraduate and graduate students may apply.',
    ));
    expect(result.workAuthorization).toContain('CPT/OPT');
    expect(result.workAuthorization).toContain('employment authorization');
  });
});
