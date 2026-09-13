import { describe, expect, it } from 'vitest';

import { SCORE_VERSION, scoreIngestionCandidate } from '../../lib/ingestion/score';
import type { ScoringInput } from '../../lib/ingestion/score';

const base: ScoringInput = {
  employerName: 'Example Biotech',
  titleRaw: 'Genomics Research Intern',
  titleNormalized: 'genomics research intern',
  locationNormalized: 'long beach, ca',
  department: 'research',
  departments: ['Research'],
  classification: 'internship',
  remoteType: 'onsite',
  canonicalUrl: 'https://example.org/jobs/1',
  descriptionText: 'Cancer genomics internship with RNA sequencing and Python analysis.',
  closesAt: null,
  uncertaintyFlags: [],
};

describe('student audience relevance scorer v4', () => {
  it('uses score version 4', () => {
    expect(SCORE_VERSION).toBe(4);
  });

  it('queues a scientifically relevant undergraduate-only internship', () => {
    const result = scoreIngestionCandidate({
      ...base,
      descriptionText: "Cancer genomics internship. Applicants must be currently enrolled in an undergraduate program; rising juniors and seniors are welcome. Work includes RNA sequencing and Python analysis.",
    });

    expect(result.taxonomyClassification.keep).toBe(true);
    expect(result.taxonomyClassification.stage.id).toBe('undergrad_only');
    expect(result.taxonomyClassification.suggestedBucket).toBe('undergraduate');
    expect(result.total).toBeGreaterThanOrEqual(35);
  });

  it('keeps doctoral-only internships below the review threshold', () => {
    const result = scoreIngestionCandidate({
      ...base,
      descriptionText: 'Cancer genomics internship for PhD students only. Work includes RNA sequencing and Python analysis.',
    });

    expect(result.taxonomyClassification.stage.id).toBe('phd_only');
    expect(result.total).toBeLessThan(35);
  });

  it('keeps post-baccalaureate programs below the core student review threshold', () => {
    const result = scoreIngestionCandidate({
      ...base,
      titleRaw: 'Genomics Post-Baccalaureate Internship',
      titleNormalized: 'genomics post baccalaureate internship',
      descriptionText: "Year-long post-baccalaureate genomics program for recent bachelor's graduates. Work includes sequencing and Python analysis.",
    });

    expect(result.taxonomyClassification.stage.id).toBe('postbac_stage');
    expect(result.total).toBeLessThan(35);
  });

  it('does not queue a non-scientific undergraduate student role', () => {
    const result = scoreIngestionCandidate({
      ...base,
      titleRaw: 'Communications Intern',
      titleNormalized: 'communications intern',
      department: 'communications',
      departments: ['Communications'],
      descriptionText: "Undergraduate students only. Support communications, media relations, and social content.",
    });

    expect(result.taxonomyClassification.keep).toBe(false);
    expect(result.total).toBeLessThan(35);
  });
});
