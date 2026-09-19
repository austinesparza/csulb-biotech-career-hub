import { describe, expect, it } from 'vitest';
import {
  evaluateClassificationFeedback,
  type ClassificationFeedbackRow,
} from '../lib/pipeline/classification-learning';

function row(
  id: string,
  proposed: Record<string, string[]>,
  final: Record<string, string[]>,
  source: ClassificationFeedbackRow['proposal_source'] = 'deterministic_taxonomy',
): ClassificationFeedbackRow {
  return {
    id,
    opportunity_id: id,
    proposal_source: source,
    taxonomy_version: source === 'deterministic_taxonomy' ? 5 : null,
    proposed_tags: proposed,
    final_tags: final,
    created_at: '2026-09-19T00:00:00.000Z',
  };
}

describe('evaluateClassificationFeedback', () => {
  it('measures independent multi-label false positives and false negatives', () => {
    const report = evaluateClassificationFeedback([
      row('1', {
        scientific_lanes: ['Genomics and genetics', 'Diagnostics and clinical data'],
        job_functions: ['Research and discovery'],
        methods: ['python'],
      }, {
        scientific_lanes: ['Genomics and genetics'],
        job_functions: ['Research and discovery'],
        methods: ['python', 'nextflow'],
      }),
      row('2', {
        scientific_lanes: ['Genomics and genetics'],
        job_functions: [],
        methods: [],
      }, {
        scientific_lanes: ['Genomics and genetics'],
        job_functions: ['Computational and analysis'],
        methods: [],
      }),
    ]);

    const lanes = report.axes.find((axis) => axis.axis === 'scientific_lanes')!;
    const genomics = lanes.labels.find((label) => label.label === 'Genomics and genetics')!;
    const diagnostics = lanes.labels.find((label) => label.label === 'Diagnostics and clinical data')!;
    const methods = report.axes.find((axis) => axis.axis === 'methods')!;

    expect(genomics).toMatchObject({ truePositive: 2, falsePositive: 0, falseNegative: 0 });
    expect(diagnostics).toMatchObject({ truePositive: 0, falsePositive: 1, falseNegative: 0, f1: 0 });
    expect(lanes.exactMatchRate).toBe(0.5);
    expect(methods.addedTags).toBe(1);
  });

  it('keeps legacy drafts in the audit count but out of machine metrics', () => {
    const report = evaluateClassificationFeedback([
      row('1', { scientific_lanes: ['Cancer'] }, { scientific_lanes: ['Cancer'] }),
      row('2', { scientific_lanes: ['Legacy'] }, { scientific_lanes: ['Changed'] }, 'legacy_draft'),
    ]);

    expect(report.reviewedSnapshots).toBe(2);
    expect(report.evaluableSnapshots).toBe(1);
    expect(report.taxonomyVersions).toEqual([5]);
  });

  it('does not declare sparse labels ready for a learned suggester', () => {
    const feedback = Array.from({ length: 30 }, (_, index) => row(
      String(index),
      { scientific_lanes: index < 7 ? ['Rare lane'] : [] },
      { scientific_lanes: index < 7 ? ['Rare lane'] : [] },
    ));
    const report = evaluateClassificationFeedback(feedback);

    expect(report.evaluableSnapshots).toBe(30);
    expect(report.readyForShadowSuggestions).toBe(false);
    expect(report.readinessReason).toContain('8 final examples');
  });
});
