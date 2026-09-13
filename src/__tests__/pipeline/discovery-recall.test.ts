import { describe, expect, it } from 'vitest';
import {
  measureDiscoveryRecall,
  type DiscoveryRecallExpectation,
} from '../../lib/pipeline/discovery-recall';

const expectations: DiscoveryRecallExpectation[] = [
  {
    id: 'helix-labs-cell-biology',
    employer: 'Helix Labs',
    title: 'Cell Biology Research Intern',
    sourceUrl: 'https://www.linkedin.com/jobs/view/fixture-helix-cell-biology',
    audience: 'unknown',
    reviewIntent: 'core',
  },
  {
    id: 'northstar-immunoassay',
    employer: 'Northstar Diagnostics',
    title: 'R&D Science Intern - Immunoassay Development',
    sourceUrl: 'https://www.linkedin.com/jobs/view/fixture-northstar-immunoassay',
    audience: 'undergraduate',
    reviewIntent: 'core',
  },
  {
    id: 'meridian-vaccines',
    employer: 'Meridian Therapeutics',
    title: 'Vaccines Process R&D Upstream Intern',
    sourceUrl: null,
    audience: 'graduate',
    reviewIntent: 'core',
  },
  {
    id: 'vector-growth',
    employer: 'Vector Bio',
    title: 'Growth Intern',
    sourceUrl: null,
    audience: 'unknown',
    reviewIntent: 'adjacent',
  },
];

describe('discovery recall evaluation', () => {
  it('keeps synthetic fixtures distinct and evidence-neutral', () => {
    expect(expectations).toHaveLength(4);
    expect(new Set(expectations.map((item) => item.employer)).size).toBe(4);
  });

  it('matches a canonical LinkedIn job URL even when visible fields are incomplete', () => {
    const target = expectations.find((item) => item.id === 'helix-labs-cell-biology')!;
    const report = measureDiscoveryRecall([target], [{
      originalUrl: 'https://linkedin.com/jobs/view/fixture-helix-cell-biology?trackingId=discarded',
      title: null,
      employer: null,
    }]);
    expect(report).toMatchObject({ expected: 1, recovered: 1, recall: 1 });
    expect(report.matches[0].matchBasis).toBe('url');
  });

  it('falls back to conservative employer and title matching', () => {
    const target = expectations.find((item) => item.id === 'northstar-immunoassay')!;
    const report = measureDiscoveryRecall([target], [{
      originalUrl: 'https://jobs.danaher.com/global/en/job/example',
      title: 'R&D Science Intern, Immunoassay Development',
      employer: 'Northstar',
    }]);
    expect(report.recovered).toBe(1);
    expect(report.matches[0].matchBasis).toBe('employer_title');
  });

  it('does not treat a same-employer unrelated internship as recovered', () => {
    const target = expectations.find((item) => item.id === 'meridian-vaccines')!;
    const report = measureDiscoveryRecall([target], [{
      originalUrl: 'https://careers.meridian.example/jobs/example',
      title: 'Commercial Operations Intern',
      employer: 'Meridian Therapeutics',
    }]);
    expect(report.recovered).toBe(0);
  });
});
