import { describe, expect, it } from 'vitest';

import { deriveOpportunityEnrichment } from '../../lib/ingestion/persistence/opportunity-bridge';
import type { NormalizedSourcePosting } from '../../lib/ingestion/types';

function posting(descriptionText: string): NormalizedSourcePosting {
  return {
    identityKey: 'greenhouse:work-auth:1',
    materialHash: 'b'.repeat(64),
    connectorVersion: 'test',
    sourceKind: 'greenhouse',
    externalPostingId: '1',
    internalJobId: null,
    requisitionId: null,
    employerNameRaw: 'Test Biotech',
    employerNameNormalized: 'test biotech',
    titleRaw: 'Genomics Intern',
    titleNormalized: 'genomics intern',
    locationRaw: 'Cambridge, MA',
    locationNormalized: 'cambridge ma',
    canonicalUrl: 'https://example.org/jobs/1',
    remoteType: 'onsite',
    employmentType: 'Internship',
    classification: 'internship',
    department: 'Research',
    departments: ['Research'],
    offices: ['Cambridge, MA'],
    focusArea: 'Genomics and genetics',
    postedAt: '2026-09-01',
    closesAt: null,
    deadlineKind: 'unknown',
    descriptionText,
    language: 'en',
    sourceUpdatedAt: '2026-09-01T00:00:00Z',
    sourceMetadata: null,
    relevanceScore: 95,
    relevanceScoreVersion: 4,
    scoreBreakdown: {
      version: 4,
      total: 95,
      rawTotal: 95,
      positiveReasons: [],
      negativeReasons: [],
      uncertaintyFlags: [],
    },
    uncertaintyFlags: [],
    fetchedAt: '2026-09-13T17:00:00Z',
  };
}

describe('work authorization evidence extraction', () => {
  it('does not treat EEO citizenship language as a work-authorization requirement', () => {
    const result = deriveOpportunityEnrichment(posting(
      "Applicants should be enrolled in a bachelor's or master's program in biology. We provide equal employment opportunity regardless of race, religion, sex, national origin, age, citizenship, disability, or veteran status.",
    ));

    expect(result.workAuthorization).toBeNull();
  });

  it('does not treat privacy opt-out language as OPT student authorization', () => {
    const result = deriveOpportunityEnrichment(posting(
      "Applicants should be enrolled in a bachelor's or master's program. California residents may opt out of the sharing of personal information under the CCPA/CPRA.",
    ));

    expect(result.workAuthorization).toBeNull();
  });

  it('ignores the combined EEO and privacy boilerplate present on the governed Flagship feed', () => {
    const result = deriveOpportunityEnrichment(posting(
      "This position is open exclusively to current Northeastern University Co-Op students. The company is committed to equal employment opportunity regardless of race, color, ancestry, religion, sex, national origin, sexual orientation, age, citizenship, marital status,