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

// ============================================================
// SOCAL GEOGRAPHY — token boundary checks
// ============================================================

describe('scoreIngestionCandidate SoCal geography safeguards', () => {
  const geoBase: ScoringInput = {
    ...BASE_INPUT,
    classification: 'other',
    descriptionText: 'Generic description.',
  };

  it('Atlanta does not receive SoCal geography bonus', () => {
    const input: ScoringInput = { ...geoBase, locationNormalized: 'atlanta, ga' };
    const breakdown = scoreIngestionCandidate(input);
    const socalBonus = breakdown.positiveReasons
      .filter((r) => r.category === 'geography')
      .reduce((s, r) => s + r.points, 0);
    expect(socalBonus).toBeLessThanOrEqual(0); // no SoCal bonus for Atlanta
  });

  it('Philadelphia does not receive SoCal geography bonus', () => {
    const input: ScoringInput = { ...geoBase, locationNormalized: 'philadelphia, pa' };
    const breakdown = scoreIngestionCandidate(input);
    const socalBonus = breakdown.positiveReasons.filter(
      (r) => r.category === 'geography' && r.reason.toLowerCase().includes('southern california'),
    );
    expect(socalBonus).toHaveLength(0);
  });

  it('Malaysia does not receive SoCal geography bonus', () => {
    const input: ScoringInput = { ...geoBase, locationNormalized: 'kuala lumpur, malaysia' };
    const breakdown = scoreIngestionCandidate(input);
    const socalBonus = breakdown.positiveReasons.filter(
      (r) => r.category === 'geography' && r.reason.toLowerCase().includes('southern california'),
    );
    expect(socalBonus).toHaveLength(0);
  });

  it('Northern California does not receive SoCal geography bonus', () => {
    const input: ScoringInput = { ...geoBase, locationNormalized: 'san francisco, ca' };
    const breakdown = scoreIngestionCandidate(input);
    const socalBonus = breakdown.positiveReasons.filter(
      (r) => r.category === 'geography' && r.reason.toLowerCase().includes('southern california'),
    );
    expect(socalBonus).toHaveLength(0);
  });

  it('Long Beach receives SoCal geography bonus', () => {
    const input: ScoringInput = { ...geoBase, locationNormalized: 'long beach, ca' };
    const breakdown = scoreIngestionCandidate(input);
    const hasGeo = breakdown.positiveReasons.some((r) => r.category === 'geography');
    expect(hasGeo).toBe(true);
  });

  it('Los Angeles receives SoCal geography bonus', () => {
    const input: ScoringInput = { ...geoBase, locationNormalized: 'los angeles, ca' };
    const breakdown = scoreIngestionCandidate(input);
    const hasGeo = breakdown.positiveReasons.some((r) => r.category === 'geography');
    expect(hasGeo).toBe(true);
  });
});

// ============================================================
// UNDERGRAD ELIGIBILITY — student-context phrases only
// ============================================================

describe('scoreIngestionCandidate undergrad eligibility', () => {
  const undergradBase: ScoringInput = { ...BASE_INPUT, classification: 'internship' };

  it('senior scientist does not receive undergrad bonus', () => {
    const input: ScoringInput = {
      ...undergradBase,
      titleRaw: 'Senior Scientist',
      titleNormalized: 'senior scientist',
      descriptionText: 'We are hiring a Senior Scientist with 5+ years experience.',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasUndergradBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'undergrad_access' && r.points > 0,
    );
    expect(hasUndergradBonus).toBe(false);
  });

  it('college junior phrase provides undergrad bonus', () => {
    const input: ScoringInput = {
      ...undergradBase,
      descriptionText: 'Open to college juniors and seniors.',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasUndergradBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'undergrad_access' && r.points > 0,
    );
    expect(hasUndergradBonus).toBe(true);
  });

  it('rising senior phrase provides undergrad bonus', () => {
    const input: ScoringInput = {
      ...undergradBase,
      descriptionText: 'Perfect for a rising senior studying biology.',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasUndergradBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'undergrad_access' && r.points > 0,
    );
    expect(hasUndergradBonus).toBe(true);
  });

  it('generic junior job title does not provide undergrad bonus', () => {
    const input: ScoringInput = {
      ...undergradBase,
      titleRaw: 'Junior Software Engineer',
      titleNormalized: 'junior software engineer',
      // No undergrad-context language; description does not mention students
      descriptionText: '2+ years of professional software engineering experience required. Strong coding skills needed.',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasUndergradBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'undergrad_access' && r.points > 0,
    );
    expect(hasUndergradBonus).toBe(false);
  });
});

// ============================================================
// DEGREE REQUIREMENTS — contextual distinction
// ============================================================

describe('scoreIngestionCandidate degree requirements', () => {
  const degreeBase: ScoringInput = {
    ...BASE_INPUT,
    classification: 'other',
    titleRaw: 'Research Position',
    titleNormalized: 'research position',
  };

  it('PhD required triggers degree penalty', () => {
    const input: ScoringInput = { ...degreeBase, descriptionText: 'PhD required. Must hold a doctoral degree.' };
    const breakdown = scoreIngestionCandidate(input);
    const hasDegreePenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'degree_req' && r.points < 0,
    );
    expect(hasDegreePenalty).toBe(true);
  });

  it('PhD preferred does NOT trigger degree penalty', () => {
    const input: ScoringInput = { ...degreeBase, descriptionText: 'A bachelor\'s degree is required. PhD experience is a plus but not required for this position.' };
    const breakdown = scoreIngestionCandidate(input);
    const hasDegreePenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'degree_req' && r.points < 0,
    );
    expect(hasDegreePenalty).toBe(false);
  });

  it('BS/MS/PhD accepted does NOT trigger degree penalty', () => {
    const input: ScoringInput = { ...degreeBase, descriptionText: 'BS/MS/PhD accepted. All levels welcome.' };
    const breakdown = scoreIngestionCandidate(input);
    const hasDegreePenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'degree_req' && r.points < 0,
    );
    expect(hasDegreePenalty).toBe(false);
  });

  it('"works with PhD scientists" does NOT trigger degree penalty', () => {
    const input: ScoringInput = { ...degreeBase, descriptionText: 'You will work alongside PhD scientists in our research lab.' };
    const breakdown = scoreIngestionCandidate(input);
    const hasDegreePenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'degree_req' && r.points < 0,
    );
    expect(hasDegreePenalty).toBe(false);
  });
});

// ============================================================
// SENIORITY — fellowship should not be penalized
// ============================================================

describe('scoreIngestionCandidate seniority for fellowships', () => {
  it('postdoctoral fellow is penalized for degree_req but not seniority', () => {
    const input: ScoringInput = {
      ...BASE_INPUT,
      titleRaw: 'Postdoctoral Fellow',
      titleNormalized: 'postdoctoral fellow',
      classification: 'other',
      descriptionText: 'PhD required. Postdoctoral fellowship position.',
    };
    const breakdown = scoreIngestionCandidate(input);
    // Has degree penalty (PhD required)
    const hasDegreePenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'degree_req' && r.points < 0,
    );
    expect(hasDegreePenalty).toBe(true);
    // Does NOT have seniority penalty for "fellow"
    const hasFellowSeniorityPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'seniority' && r.reason.toLowerCase().includes('fellow'),
    );
    expect(hasFellowSeniorityPenalty).toBe(false);
  });

  it('research fellowship is not penalized as executive seniority', () => {
    const input: ScoringInput = {
      ...BASE_INPUT,
      titleRaw: 'Research Fellowship',
      titleNormalized: 'research fellowship',
      classification: 'other',
      descriptionText: 'Research fellowship for early career scientists.',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasSeniorityPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'seniority' && r.points < 0,
    );
    expect(hasSeniorityPenalty).toBe(false);
  });
});

// ============================================================
// ELIGIBILITY FLAGS — derived from description
// ============================================================

describe('scoreIngestionCandidate eligibility flag derivation', () => {
  it('eligibility_missing is populated when description is absent', () => {
    const input: ScoringInput = {
      ...BASE_INPUT,
      descriptionText: null,
      uncertaintyFlags: [],
    };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.uncertaintyFlags).toContain('eligibility_missing');
  });

  it('eligibility_ambiguous is populated when description has no clear eligibility signals', () => {
    const input: ScoringInput = {
      ...BASE_INPUT,
      descriptionText: 'Exciting opportunity at our company. Great benefits.',
      uncertaintyFlags: [],
    };
    const breakdown = scoreIngestionCandidate(input);
    // Should be either ambiguous or normal — not missing (description is present)
    expect(breakdown.uncertaintyFlags).not.toContain('eligibility_missing');
    // Must assert eligibility_ambiguous when no eligibility signals are found
    expect(breakdown.uncertaintyFlags).toContain('eligibility_ambiguous');
  });
});

// ============================================================
// DEADLINE SCORING — uses injected reference date deterministically
// ============================================================

describe('scoreIngestionCandidate deadline scoring', () => {
  const futureInput: ScoringInput = {
    ...BASE_INPUT,
    closesAt: '2030-12-31', // far future regardless of wall clock
  };

  const expiredInput: ScoringInput = {
    ...BASE_INPUT,
    closesAt: '2020-01-01', // always in the past
  };

  it('upcoming deadline gives positive deadline score with fixed reference date', () => {
    const referenceNow = new Date('2026-07-01T00:00:00.000Z');
    const breakdown = scoreIngestionCandidate({ ...futureInput, closesAt: '2026-09-01' }, referenceNow);
    // Should not have expired deadline penalty
    const hasExpiredPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'deadline' && r.reason.toLowerCase().includes('expired'),
    );
    expect(hasExpiredPenalty).toBe(false);
  });

  it('expired deadline gives negative deadline score', () => {
    const referenceNow = new Date('2026-07-01T00:00:00.000Z');
    const breakdown = scoreIngestionCandidate(expiredInput, referenceNow);
    const hasExpiredPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'deadline' && r.points < 0,
    );
    expect(hasExpiredPenalty).toBe(true);
  });

  it('deadline scoring is deterministic with same reference date', () => {
    const ref = new Date('2026-07-01T00:00:00.000Z');
    const a = scoreIngestionCandidate(futureInput, ref);
    const b = scoreIngestionCandidate(futureInput, ref);
    expect(a.total).toBe(b.total);
  });
});

// ============================================================
// DEADLINE SCORING — date-only same-day not expired
// ============================================================

describe('scoreIngestionCandidate date-only deadline edge cases', () => {
  it('date-only deadline equal to reference date is NOT expired', () => {
    // The deadline "2026-09-15" should not be expired at the START of 2026-09-15
    const referenceNow = new Date('2026-09-15T00:00:00.000Z'); // midnight UTC
    const input: ScoringInput = { ...BASE_INPUT, closesAt: '2026-09-15' };
    const breakdown = scoreIngestionCandidate(input, referenceNow);
    const hasExpiredPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'deadline' && r.reason.toLowerCase().includes('passed'),
    );
    expect(hasExpiredPenalty).toBe(false);
  });

  it('date-only deadline equal to reference date is NOT expired at noon', () => {
    const referenceNow = new Date('2026-09-15T12:00:00.000Z'); // noon UTC
    const input: ScoringInput = { ...BASE_INPUT, closesAt: '2026-09-15' };
    const breakdown = scoreIngestionCandidate(input, referenceNow);
    const hasExpiredPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'deadline' && r.reason.toLowerCase().includes('passed'),
    );
    expect(hasExpiredPenalty).toBe(false);
  });

  it('date-only deadline one day before reference date IS expired', () => {
    const referenceNow = new Date('2026-09-16T00:00:00.000Z');
    const input: ScoringInput = { ...BASE_INPUT, closesAt: '2026-09-15' };
    const breakdown = scoreIngestionCandidate(input, referenceNow);
    const hasExpiredPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'deadline' && r.points < 0,
    );
    expect(hasExpiredPenalty).toBe(true);
  });

  it('date-only deadline one day after reference date is upcoming', () => {
    const referenceNow = new Date('2026-09-14T00:00:00.000Z');
    const input: ScoringInput = { ...BASE_INPUT, closesAt: '2026-09-15' };
    const breakdown = scoreIngestionCandidate(input, referenceNow);
    const hasExpiredPenalty = breakdown.negativeReasons.some(
      (r) => r.category === 'deadline' && r.reason.toLowerCase().includes('passed'),
    );
    expect(hasExpiredPenalty).toBe(false);
  });
});

// ============================================================
// HYBRID GEOGRAPHY — bonus only within SoCal
// ============================================================

describe('scoreIngestionCandidate hybrid geography restriction', () => {
  const hybridBase: ScoringInput = {
    ...BASE_INPUT,
    remoteType: 'hybrid',
    classification: 'other',
    descriptionText: 'Hybrid schedule, no clear eligibility signals.',
  };

  it('Boston hybrid does NOT receive geography bonus', () => {
    const input: ScoringInput = {
      ...hybridBase,
      locationNormalized: 'boston, ma',
    };
    const breakdown = scoreIngestionCandidate(input);
    const geoPoints = breakdown.positiveReasons
      .filter((r) => r.category === 'geography')
      .reduce((s, r) => s + r.points, 0);
    expect(geoPoints).toBe(0);
  });

  it('New York hybrid does NOT receive geography bonus', () => {
    const input: ScoringInput = {
      ...hybridBase,
      locationNormalized: 'new york, ny',
    };
    const breakdown = scoreIngestionCandidate(input);
    const geoPoints = breakdown.positiveReasons
      .filter((r) => r.category === 'geography')
      .reduce((s, r) => s + r.points, 0);
    expect(geoPoints).toBe(0);
  });

  it('Long Beach hybrid DOES receive geography bonus', () => {
    const input: ScoringInput = {
      ...hybridBase,
      locationNormalized: 'long beach, ca',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasGeoBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'geography' && r.points > 0,
    );
    expect(hasGeoBonus).toBe(true);
  });

  it('Irvine hybrid DOES receive geography bonus', () => {
    const input: ScoringInput = {
      ...hybridBase,
      locationNormalized: 'irvine, ca',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasGeoBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'geography' && r.points > 0,
    );
    expect(hasGeoBonus).toBe(true);
  });

  it('remote position DOES receive geography bonus regardless of location', () => {
    const input: ScoringInput = {
      ...hybridBase,
      remoteType: 'remote',
      locationNormalized: 'boston, ma',
    };
    const breakdown = scoreIngestionCandidate(input);
    const hasGeoBonus = breakdown.positiveReasons.some(
      (r) => r.category === 'geography' && r.points > 0,
    );
    expect(hasGeoBonus).toBe(true);
  });
});

// ============================================================
// DEGREE PATTERNS — real RegExp detection
// ============================================================

describe('scoreIngestionCandidate degree pattern detection', () => {
  const base: ScoringInput = {
    ...BASE_INPUT,
    classification: 'other',
    titleRaw: 'Research Scientist',
    titleNormalized: 'research scientist',
  };

  it('detects "requires a PhD"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'This position requires a PhD in molecular biology.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req')).toBe(true);
  });

  it('detects "minimum qualification is a PhD"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'Minimum qualification is a PhD in a relevant field.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req')).toBe(true);
  });

  it('detects "PhD is required"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'A PhD is required for this role.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req')).toBe(true);
  });

  it('detects "must hold a doctorate"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'Candidates must hold a doctorate in chemistry.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req')).toBe(true);
  });

  it('does NOT penalize "PhD preferred"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'PhD preferred but not required. BS accepted.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req' && r.points < 0)).toBe(false);
  });

  it('does NOT penalize "PhD not required"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'A PhD is not required for this internship position.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req' && r.points < 0)).toBe(false);
  });

  it('does NOT penalize "BS/MS/PhD accepted"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'BS/MS/PhD accepted. All degree levels welcome.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req' && r.points < 0)).toBe(false);
  });

  it('does NOT penalize "works with PhD scientists"', () => {
    const input: ScoringInput = { ...base, descriptionText: 'You will work alongside PhD scientists in our research laboratory.' };
    const breakdown = scoreIngestionCandidate(input);
    expect(breakdown.negativeReasons.some((r) => r.category === 'degree_req' && r.points < 0)).toBe(false);
  });
});
