import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_FEATURE_NAMES,
  featuresForDiscoveryLead,
  predictDiscoveryRelevance,
  summarizeRecallGaps,
  summarizeQueryYield,
  trainDiscoveryRanker,
  type DiscoveryLearningInput,
  type DiscoveryLearningLabel,
} from '../lib/pipeline/discovery-learning';

function fixture(
  index: number,
  label: DiscoveryLearningLabel,
  positiveSignals = label === 'relevant',
): DiscoveryLearningInput {
  return {
    leadId: `lead-${index}`,
    label,
    labeledAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    route: positiveSignals ? 'employer_page' : 'web_search',
    resolution: positiveSignals ? 'official_source_found' : 'unresolved',
    occurrenceCount: positiveSignals ? 3 : 1,
    employerHint: positiveSignals ? 'Example Bio' : null,
    latestSnippet: positiveSignals ? 'Graduate research internship in cell biology' : null,
    lane: positiveSignals ? 'cancer_oncology' : null,
    observationMetadata: {
      rank: positiveSignals ? 1 : 8,
      discoveryBasis: positiveSignals ? 'historical_role_watch' : 'scientific_lane_rotation',
      queryRoute: positiveSignals ? 'employer_page' : 'web_search',
      snippetTriage: {
        score: positiveSignals ? 32 : 2,
        keep: positiveSignals,
        suggestedBucket: positiveSignals ? 'graduate' : 'excluded',
      },
    },
  };
}

describe('discovery learning features', () => {
  it('creates a stable, bounded, auditable feature vector', () => {
    const vector = featuresForDiscoveryLead(fixture(1, 'relevant'));
    expect(vector.values).toHaveLength(DISCOVERY_FEATURE_NAMES.length);
    expect(vector.values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(vector.named.official_route).toBe(1);
    expect(vector.named.linkedin_route).toBe(0);
    expect(vector.queryFamily).toBe('historical_role_watch:employer_page:cancer_oncology');
  });

  it('uses the feature and query snapshots frozen when the label was recorded', () => {
    const input = fixture(2, 'relevant', false);
    input.featureSnapshot = Object.fromEntries(DISCOVERY_FEATURE_NAMES.map((name) => [name, name === 'triage_keep' ? 1 : 0]));
    input.queryFamilySnapshot = 'frozen:family:all_lanes';
    input.occurrenceCount = 99;
    input.resolution = 'official_source_found';
    const vector = featuresForDiscoveryLead(input);
    expect(vector.named.triage_keep).toBe(1);
    expect(vector.named.repeat_observation).toBe(0);
    expect(vector.named.official_route).toBe(0);
    expect(vector.queryFamily).toBe('frozen:family:all_lanes');
  });

  it('does not turn duplicate, closed, or unverifiable outcomes into negatives', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, index) => fixture(index, 'relevant')),
      ...Array.from({ length: 9 }, (_, index) => fixture(index + 10, 'irrelevant')),
      fixture(30, 'duplicate'),
      fixture(31, 'closed'),
      fixture(32, 'unverifiable'),
    ];
    const result = trainDiscoveryRanker(rows);
    expect(result).toMatchObject({
      status: 'insufficient_data',
      usableRows: 18,
      positives: 9,
      negatives: 9,
    });
  });
});

describe('discovery shadow ranker', () => {
  it('trains only after the sample gate and evaluates on a time-ordered holdout', () => {
    const rows = Array.from({ length: 80 }, (_, index) => {
      const relevant = index % 2 === 0;
      return fixture(index, relevant ? 'relevant' : 'irrelevant', relevant);
    });
    const result = trainDiscoveryRanker(rows);
    expect(result.status).toBe('trained');
    if (result.status !== 'trained') return;
    expect(result.evaluation.trainingRows).toBe(80);
    expect(result.evaluation.holdoutPositives).toBeGreaterThanOrEqual(3);
    expect(result.evaluation.holdoutNegatives).toBeGreaterThanOrEqual(3);
    expect(result.evaluation.rocAuc).toBeGreaterThan(0.9);
    expect(result.evaluation.logLoss).toBeLessThan(result.evaluation.baselineLogLoss!);
    expect(result.evaluation.passesInfluenceGate).toBe(true);

    const relevant = featuresForDiscoveryLead(fixture(100, 'relevant', true));
    const irrelevant = featuresForDiscoveryLead(fixture(101, 'irrelevant', false));
    expect(predictDiscoveryRelevance(result.model, relevant.values))
      .toBeGreaterThan(predictDiscoveryRelevance(result.model, irrelevant.values));
  });

  it('reports smoothed query-family yield without suppressing exploration', () => {
    const rows = [
      fixture(1, 'relevant', true),
      fixture(2, 'relevant', true),
      fixture(3, 'irrelevant', true),
      fixture(4, 'irrelevant', false),
      fixture(5, 'duplicate', false),
    ];
    const yieldRows = summarizeQueryYield(rows);
    const historical = yieldRows.find((row) => row.family.startsWith('historical_role_watch'));
    expect(historical).toMatchObject({ labelled: 3, relevant: 2, irrelevant: 1 });
    expect(historical!.posteriorMean).toBeCloseTo(0.6);
    expect(yieldRows.reduce((sum, row) => sum + row.labelled, 0)).toBe(4);
  });

  it('separates manually reported misses from automated query yield', () => {
    const automated = fixture(1, 'relevant', true);
    const missed = fixture(2, 'relevant', true);
    missed.labelSource = 'missed_role';
    missed.route = 'linkedin_lead';
    missed.employerHint = 'Example Bio';

    const yieldRows = summarizeQueryYield([automated, missed]);
    expect(yieldRows.reduce((sum, row) => sum + row.labelled, 0)).toBe(1);
    expect(summarizeRecallGaps([automated, missed])).toEqual({
      total: 1,
      byRoute: [{ value: 'linkedin_lead', count: 1 }],
      byEmployer: [{ value: 'Example Bio', count: 1 }],
      byLane: [{ value: 'cancer_oncology', count: 1 }],
    });
  });
});
