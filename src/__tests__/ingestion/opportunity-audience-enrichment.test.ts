import { describe, expect, it } from 'vitest';

import { deriveOpportunityEnrichment } from '../../lib/ingestion/persistence/opportunity-bridge';
import type { NormalizedSourcePosting } from '../../lib/ingestion/types';

function posting(descriptionText: string, titleRaw = 'Genomics Co-Op'): NormalizedSourcePosting {
  return {
    identityKey: 'greenhouse:test:1',
    materialHash: 'a'.repeat(64),
    connectorVersion: 'test',
    sourceKind: 'greenhouse',
    externalPostingId: '1',
    internalJobId: null,
    requisitionId: null,
    employerNameRaw: 'Test Biotech',
    employerNameNormalized: 'test biotech',
    titleRaw,
    titleNormalized: titleRaw.toLowerCase(),
    locationRaw: 'Cambridge, MA',
    locationNormalized: 'cambridge ma',
    canonicalUrl: 'https://example.org/jobs/1',
    remoteType: 'onsite',
    employmentType: 'Co-Op',
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
    relevanceScoreVersion: 3,
    scoreBreakdown: {
      version: 3,
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

describe('opportunity audience enrichment', () => {
  it('maps unrestricted BS or MS eligibility to mixed audience', () => {
    const result = deriveOpportunityEnrichment(posting(
      'Currently enrolled in a B.S. or M.S. program in Molecular Biology or Genetics. Perform CRISPR, qPCR, and sequencing experiments.',
    ));

    expect(result.graduateStage).toBe('msc_any');
    expect(result.audienceBucket).toBe('mixed');
    expect(result.eligibility).toContain('B.S. or M.S.');
  });

  it('maps an unrestricted master-only program to graduate audience', () => {
    const result = deriveOpportunityEnrichment(posting(
      "Enrollment in a master's degree program in computer science or machine learning. Build computational biology and data science systems.",
      'Agentic AI Co-Op',
    ));

    expect(result.graduateStage).toBe('msc_any');
    expect(result.audienceBucket).toBe('graduate');
  });

  it('keeps an institution-exclusive BS or MS co-op special and extracts qualification evidence instead of LC-MS method text', () => {
    const result = deriveOpportunityEnrichment(posting(
      'This position is open exclusively to current Northeastern University Co-Op students. Use LC-MS/MS and Orbitrap mass spectrometry for proteomics. Execute LC-MS analysis and sample preparation. Currently enrolled in a B.S. or M.S. program in Chemistry, Chemical Biology, or Biochemistry.',
      'Proteomics Co-Op',
    ));

    expect(result.graduateStage).toBe('msc_any');
    expect(result.audienceBucket).toBe('special');
    expect(result.eligibility).toContain('Currently enrolled in a B.S. or M.S. program');
    expect(result.eligibility).not.toContain('Execute LC-MS analysis');
  });
});
