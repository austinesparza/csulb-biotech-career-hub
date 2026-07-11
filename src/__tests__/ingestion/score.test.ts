import { describe, it, expect } from 'vitest';
import { scoreIngestionCandidate, SCORE_VERSION } from '../../lib/ingestion/score';
import type { ScoringInput } from '../../lib/ingestion/score';

const BASE_INPUT: ScoringInput = {
  titleRaw: 'Biotechnology Intern',
  titleNormalized: 'biotechnology intern',
  locationNormalized: 'long beach, ca',
  department: 'research & development',
  departments: ['Research & Development'],
  classification: 'internship',
  remoteType: 'onsite',
  canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/1001001',
  descriptionText: 'This is a paid undergraduate internship. Open to juniors and seniors pursuing a bachelor\'s in Biology or Biotechnology.',
  closesAt: '2026-12-01',
  uncertaintyFlags: [],
};

describe('scoreIngestionCandidate', () => {
  it('returns a score within 0–100', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
    expect(breakdown.total).toBeLessThanOrEqual(100);
  });

  it('score version matches SCORE_VERSION constant', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    expect(breakdown.version).toBe(SCORE_VERSION);
    expect(breakdown.version).toBeGreaterThan(0);
  });

  it('returns a complete breakdown', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    expect(typeof breakdown.total).toBe('number');
    expect(typeof breakdown.rawTotal).toBe('number');
    expect(Array.isArray(breakdown.positiveReasons)).toBe(true);
    expect(Array.isArray(breakdown.negativeReasons)).toBe(true);
  });

  it('breakdown reasons have category, points, and reason fields', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    for (const r of [...breakdown.positiveReasons, ...breakdown.negativeReasons]) {
      expect(typeof r.category).toBe('string');
      expect(typeof r.points).toBe('number');
      expect(typeof r.reason).toBe('string');
    }
  });

  it('scores biotechnology internship highly', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    expect(breakdown.total).toBeGreaterThan(50);
  });

  it('gives positive points for biotech title', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    const hasBiotechReason = breakdown.positiveReasons.some(
      (r) => r.category === 'biotech_relevance',
    );
    expect(hasBiotechReason).toBe(true);
  });

  it('gives positive points for internship classification', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    const hasRoleReason = breakdown.positiveReasons.some(
      (r) => r.category === 'role_type',
    );
    expect(hasRoleReason).toBe(true);
  });

  it('gives positive points for undergrad-accessible description', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    const hasUndergradReason = breakdown.positiveReasons.some(
      (r) => r.category === 'undergrad_access',
    );
    expect(hasUndergradReason).toBe(true);
  });

  it('penalizes senior/director titles', () => {
    const seniorInput: ScoringInput = {
      ...BASE_INPUT,
      titleRaw: 'Senior Director, Corporate Development',
      titleNormalized: 'senior director corporate development',
      classification: 'other',
      descriptionText: '15+ years required.',
    };
    const breakdown = scoreIngestionCandidate(seniorInput);
    const hasSeniorityPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'seniority' && r.points < 0,
    );
    expect(hasSeniorityPenalty).toBe(true);
  });

  it('penalizes PhD-required roles', () => {
    const phdInput: ScoringInput = {
      ...BASE_INPUT,
      titleRaw: 'Postdoc Research Fellow',
      titleNormalized: 'postdoc research fellow',
      descriptionText: 'PhD required. Postdoctoral position.',
    };
    const breakdown = scoreIngestionCandidate(phdInput);
    const hasDegreePenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'degree_req' && r.points < 0,
    );
    expect(hasDegreePenalty).toBe(true);
  });

  it('gives positive points for remote position', () => {
    const remoteInput: ScoringInput = {
      ...BASE_INPUT,
      remoteType: 'remote',
      locationNormalized: 'remote',
    };
    const breakdown = scoreIngestionCandidate(remoteInput);
    const hasRemoteBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'geography',
    );
    expect(hasRemoteBonus).toBe(true);
  });

  it('gives positive points for Southern California location', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT); // long beach, ca
    const hasGeoBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'geography',
    );
    expect(hasGeoBonus).toBe(true);
  });

  it('penalizes missing application URL', () => {
    const noUrl: ScoringInput = { ...BASE_INPUT, canonicalUrl: null };
    const breakdown = scoreIngestionCandidate(noUrl);
    const hasUrlPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'link_quality' && r.points < 0,
    );
    expect(hasUrlPenalty).toBe(true);
  });

  it('is deterministic — same input produces same score', () => {
    const a = scoreIngestionCandidate(BASE_INPUT);
    const b = scoreIngestionCandidate(BASE_INPUT);
    expect(a.total).toBe(b.total);
    expect(a.version).toBe(b.version);
  });

  it('never produces score below 0', () => {
    const worstCase: ScoringInput = {
      titleRaw: 'Senior Vice President, Head of Sales',
      titleNormalized: 'senior vice president head of sales',
      locationNormalized: null,
      department: 'real estate',
      departments: ['Real Estate'],
      classification: 'other',
      remoteType: 'unknown',
      canonicalUrl: null,
      descriptionText: 'PhD required. Graduate students only. 20 years experience needed.',
      closesAt: null,
      uncertaintyFlags: ['eligibility_missing', 'location_missing'],
    };
    const breakdown = scoreIngestionCandidate(worstCase);
    expect(breakdown.total).toBeGreaterThanOrEqual(0);
  });

  it('never produces score above 100', () => {
    const bestCase: ScoringInput = {
      titleRaw: 'Bioinformatics Intern',
      titleNormalized: 'bioinformatics intern',
      locationNormalized: 'long beach, ca',
      department: 'research & development',
      departments: ['Research & Development', 'Genomics', 'Bioinformatics'],
      classification: 'internship',
      remoteType: 'remote',
      canonicalUrl: 'https://example.com/job',
      descriptionText: 'Paid internship. Undergraduates welcome. Bachelor\'s students encouraged to apply.',
      closesAt: '2026-12-01',
      uncertaintyFlags: [],
    };
    const breakdown = scoreIngestionCandidate(bestCase);
    expect(breakdown.total).toBeLessThanOrEqual(100);
  });

  it('score and score version are always both present', () => {
    const breakdown = scoreIngestionCandidate(BASE_INPUT);
    expect(breakdown.total).not.toBeNull();
    expect(breakdown.version).not.toBeNull();
    expect(breakdown.version).toBeGreaterThan(0);
  });
});
