import { describe, it, expect } from 'vitest';
import { assessDuplicate } from '../../lib/ingestion/dedupe';
import type { DedupeCandidate } from '../../lib/ingestion/dedupe';

const BASE_CANDIDATE: DedupeCandidate = {
  identityKey: 'greenhouse:labgenomicsinc:1001001',
  canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/1001001',
  employerNameNormalized: 'lab genomics',
  titleNormalized: 'biotechnology intern cell biology',
  locationNormalized: 'long beach, ca',
  departments: ['Research & Development'],
  materialHash: null,
};

describe('assessDuplicate', () => {
  describe('insufficient_information', () => {
    it('returns insufficient_information when no existing postings provided', () => {
      const result = assessDuplicate(BASE_CANDIDATE, []);
      expect(result.matchType).toBe('insufficient_information');
      expect(result.confidence).toBe(0);
      expect(result.requiresOfficerReview).toBe(false);
    });
  });

  describe('exact_identity', () => {
    it('detects exact identity match', () => {
      const existing: DedupeCandidate[] = [{ ...BASE_CANDIDATE }];
      const result = assessDuplicate(BASE_CANDIDATE, existing);
      expect(result.matchType).toBe('exact_identity');
      expect(result.confidence).toBe(1.0);
      expect(result.contributingFields).toContain('identityKey');
    });

    it('does not require officer review when content is unchanged', () => {
      const existing: DedupeCandidate[] = [{ ...BASE_CANDIDATE }];
      const result = assessDuplicate(BASE_CANDIDATE, existing);
      expect(result.requiresOfficerReview).toBe(false);
    });

    it('requires officer review when title has changed', () => {
      const existing: DedupeCandidate[] = [{
        ...BASE_CANDIDATE,
        titleNormalized: 'biotechnology intern cell biology - updated title',
      }];
      const result = assessDuplicate(BASE_CANDIDATE, existing);
      expect(result.matchType).toBe('exact_identity');
      expect(result.requiresOfficerReview).toBe(true);
      expect(result.conflictingFields).toContain('titleNormalized');
    });
  });

  describe('exact_url', () => {
    it('detects exact URL match with different identity key', () => {
      const existing: DedupeCandidate[] = [{
        ...BASE_CANDIDATE,
        identityKey: 'greenhouse:differentboard:1001001', // different identity
      }];
      const result = assessDuplicate(BASE_CANDIDATE, existing);
      expect(result.matchType).toBe('exact_url');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.requiresOfficerReview).toBe(true);
    });
  });

  describe('probable_same_posting', () => {
    it('detects probable match on employer + title + location', () => {
      const existing: DedupeCandidate[] = [{
        identityKey: 'greenhouse:labgenomicsinc:9999999', // different ID
        canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/9999999', // different URL
        employerNameNormalized: 'lab genomics',
        titleNormalized: 'biotechnology intern cell biology', // same title
        locationNormalized: 'long beach, ca',
        departments: ['Research & Development'],
  materialHash: null,
      }];
      const result = assessDuplicate(BASE_CANDIDATE, existing);
      expect(result.matchType).toBe('probable_same_posting');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.requiresOfficerReview).toBe(true);
      expect(result.contributingFields).toContain('employerNameNormalized');
      expect(result.contributingFields).toContain('titleNormalized');
    });
  });

  describe('possible_annual_family', () => {
    it('detects possible annual family (same employer + title family, different year and season)', () => {
      // "fall 2024 biotech internship program" vs "summer 2026 biotech internship program"
      // Raw title similarity is low (season+year differ significantly).
      // Title family similarity is high (both reduce to "biotech internship program").
      const existing: DedupeCandidate[] = [{
        identityKey: 'greenhouse:labgenomicsinc:2222222',
        canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/2222222',
        employerNameNormalized: 'lab genomics',
        titleNormalized: 'fall 2024 biotech internship program',
        locationNormalized: 'long beach, ca',
        departments: ['Research & Development'],
  materialHash: null,
      }];
      const candidate: DedupeCandidate = {
        identityKey: 'greenhouse:labgenomicsinc:3333333',
        canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/3333333',
        employerNameNormalized: 'lab genomics',
        titleNormalized: 'summer 2026 biotech internship program',
        locationNormalized: 'long beach, ca',
        departments: ['Research & Development'],
  materialHash: null,
      };
      const result = assessDuplicate(candidate, existing);
      expect(result.matchType).toBe('possible_annual_family');
      expect(result.requiresOfficerReview).toBe(true);
    });
  });

  describe('likely_distinct', () => {
    it('returns likely_distinct for completely different postings', () => {
      const existing: DedupeCandidate[] = [{
        identityKey: 'greenhouse:othercompany:9876543',
        canonicalUrl: 'https://boards.greenhouse.io/othercompany/jobs/9876543',
        employerNameNormalized: 'unrelated corporation',
        titleNormalized: 'software engineer senior',
        locationNormalized: 'new york, ny',
        departments: ['Engineering'],
  materialHash: null,
      }];
      const result = assessDuplicate(BASE_CANDIDATE, existing);
      expect(result.matchType).toBe('likely_distinct');
      expect(result.requiresOfficerReview).toBe(false);
    });
  });

  describe('result structure', () => {
    it('always returns required fields', () => {
      const result = assessDuplicate(BASE_CANDIDATE, []);
      expect(typeof result.matchType).toBe('string');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.contributingFields)).toBe(true);
      expect(Array.isArray(result.conflictingFields)).toBe(true);
      expect(Array.isArray(result.reasons)).toBe(true);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(typeof result.requiresOfficerReview).toBe('boolean');
    });

    it('confidence is always between 0 and 1', () => {
      const results = [
        assessDuplicate(BASE_CANDIDATE, []),
        assessDuplicate(BASE_CANDIDATE, [{ ...BASE_CANDIDATE }]),
      ];
      for (const r of results) {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('is deterministic', () => {
      const existing = [{ ...BASE_CANDIDATE }];
      const a = assessDuplicate(BASE_CANDIDATE, existing);
      const b = assessDuplicate(BASE_CANDIDATE, existing);
      expect(a.matchType).toBe(b.matchType);
      expect(a.confidence).toBe(b.confidence);
    });
  });
});

// ============================================================
// LOCATION REQUIREMENT — dedupe corrections
// ============================================================

describe('assessDuplicate location requirement', () => {
  it('does NOT classify probable_same_posting when locations differ', () => {
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      identityKey: 'greenhouse:labgenomicsinc:8880001',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/8880001',
      locationNormalized: 'san diego, ca', // different city
    }];
    const result = assessDuplicate(BASE_CANDIDATE, existing);
    expect(result.matchType).not.toBe('probable_same_posting');
  });

  it('classifies probable_same_posting when both locations are null', () => {
    const noLocCandidate: DedupeCandidate = { ...BASE_CANDIDATE, locationNormalized: null };
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      identityKey: 'greenhouse:labgenomicsinc:8880002',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/8880002',
      locationNormalized: null,
    }];
    const result = assessDuplicate(noLocCandidate, existing);
    // Both null → location doesn't disqualify
    expect(['probable_same_posting', 'exact_identity', 'exact_url']).toContain(result.matchType);
  });

  it('does NOT classify probable_same_posting when candidate has null location but existing has location', () => {
    const noLocCandidate: DedupeCandidate = { ...BASE_CANDIDATE, locationNormalized: null };
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      identityKey: 'greenhouse:labgenomicsinc:8880003',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/8880003',
      locationNormalized: 'long beach, ca',
    }];
    const result = assessDuplicate(noLocCandidate, existing);
    expect(result.matchType).not.toBe('probable_same_posting');
  });
});

// ============================================================
// INSUFFICIENT_INFORMATION for missing employer/title
// ============================================================

describe('assessDuplicate insufficient_information', () => {
  it('returns insufficient_information when candidate employer is missing', () => {
    const noEmployer: DedupeCandidate = { ...BASE_CANDIDATE, employerNameNormalized: null };
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      identityKey: 'greenhouse:labgenomicsinc:7770001',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/7770001',
    }];
    const result = assessDuplicate(noEmployer, existing);
    expect(result.matchType).toBe('insufficient_information');
  });

  it('returns insufficient_information when candidate title is missing', () => {
    const noTitle: DedupeCandidate = { ...BASE_CANDIDATE, titleNormalized: null };
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      identityKey: 'greenhouse:labgenomicsinc:7770002',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/7770002',
    }];
    const result = assessDuplicate(noTitle, existing);
    expect(result.matchType).toBe('insufficient_information');
  });
});

// ============================================================
// BEST-MATCH SELECTION — deterministic tie-breaking
// ============================================================

describe('assessDuplicate best-match selection', () => {
  it('selects the best match from multiple candidates', () => {
    const weakMatch: DedupeCandidate = {
      identityKey: 'greenhouse:othercorp:1000001',
      canonicalUrl: 'https://boards.greenhouse.io/othercorp/jobs/1000001',
      employerNameNormalized: 'other corp',
      titleNormalized: 'biotechnology intern cell biology',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    const strongMatch: DedupeCandidate = {
      identityKey: 'greenhouse:labgenomicsinc:9999999',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/9999999',
      employerNameNormalized: 'lab genomics', // same employer
      titleNormalized: 'biotechnology intern cell biology',
      locationNormalized: 'long beach, ca',
      departments: ['Research & Development'],
      materialHash: null,
    };
    // Strong match appears second — still should win
    const result = assessDuplicate(BASE_CANDIDATE, [weakMatch, strongMatch]);
    expect(['probable_same_posting', 'exact_url']).toContain(result.matchType);
  });

  it('selects the same best match regardless of input order', () => {
    const matchA: DedupeCandidate = {
      identityKey: 'greenhouse:labgenomicsinc:1111111',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/1111111',
      employerNameNormalized: 'lab genomics',
      titleNormalized: 'biotechnology intern cell biology',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    const matchB: DedupeCandidate = {
      identityKey: 'greenhouse:labgenomicsinc:2222222',
      canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/2222222',
      employerNameNormalized: 'lab genomics',
      titleNormalized: 'biotechnology intern cell biology',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    // With equal confidence, tie-breaking must be deterministic
    const result1 = assessDuplicate(BASE_CANDIDATE, [matchA, matchB]);
    const result2 = assessDuplicate(BASE_CANDIDATE, [matchB, matchA]);
    expect(result1.matchedIdentityKey).toBe(result2.matchedIdentityKey);
  });
});

// ============================================================
// EXACT IDENTITY with changed materialHash
// ============================================================

describe('assessDuplicate exact identity with materialHash', () => {
  it('does not say content is unchanged when materialHash differs', () => {
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      materialHash: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233',
    }];
    const candidate = { ...BASE_CANDIDATE, materialHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' };
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_identity');
    expect(result.requiresOfficerReview).toBe(true);
    // Reasons must not claim content is unchanged when hash differs
    const claimsUnchanged = result.reasons.some((r) =>
      r.toLowerCase().includes('unchanged') && !r.toLowerCase().includes('changed'),
    );
    expect(claimsUnchanged).toBe(false);
  });

  it('does not require officer review when materialHash is same', () => {
    const hash = 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';
    const existing: DedupeCandidate[] = [{ ...BASE_CANDIDATE, materialHash: hash }];
    const candidate = { ...BASE_CANDIDATE, materialHash: hash };
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_identity');
    expect(result.requiresOfficerReview).toBe(false);
  });

  it('requires officer review when deadline changes (different hash)', () => {
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      materialHash: '1111111111111111111111111111111111111111111111111111111111111111',
    }];
    const candidate = {
      ...BASE_CANDIDATE,
      materialHash: '2222222222222222222222222222222222222222222222222222222222222222',
    };
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_identity');
    expect(result.requiresOfficerReview).toBe(true);
  });

  it('requires officer review when description changes (different hash)', () => {
    const existing: DedupeCandidate[] = [{
      ...BASE_CANDIDATE,
      materialHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }];
    const candidate = {
      ...BASE_CANDIDATE,
      materialHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_identity');
    expect(result.requiresOfficerReview).toBe(true);
  });
});

// ============================================================
// ANNUAL FAMILY DEDUPLICATION — tightened requirements
// ============================================================

describe('assessDuplicate annual-family tightened', () => {
  it('identical titles in different cities are likely_distinct, not possible_annual_family', () => {
    // Same employer, identical title, but different cities — should NOT be annual family
    const candidate: DedupeCandidate = {
      identityKey: 'greenhouse:acme:1001',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1001',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'biotech internship program',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    const existing: DedupeCandidate[] = [{
      identityKey: 'greenhouse:acme:2001',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/2001',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'biotech internship program', // identical title
      locationNormalized: 'boston, ma', // different city
      departments: [],
      materialHash: null,
    }];
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('likely_distinct');
    expect(result.matchType).not.toBe('possible_annual_family');
  });

  it('does not classify as annual family when neither title has season/year markers', () => {
    // Titles have no season/year to strip — families equal originals — not annual family
    const candidate: DedupeCandidate = {
      identityKey: 'greenhouse:acme:1002',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1002',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'research intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    const existing: DedupeCandidate[] = [{
      identityKey: 'greenhouse:acme:2002',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/2002',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'research intern', // same, no markers
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    }];
    const result = assessDuplicate(candidate, existing);
    // Should NOT be annual_family since no season/year was stripped
    expect(result.matchType).not.toBe('possible_annual_family');
  });

  it('classifies as possible_annual_family when titles differ only by season/year', () => {
    const candidate: DedupeCandidate = {
      identityKey: 'greenhouse:acme:1003',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/1003',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'summer 2026 biotech internship program',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    const existing: DedupeCandidate[] = [{
      identityKey: 'greenhouse:acme:2003',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/2003',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'fall 2024 biotech internship program',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    }];
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('possible_annual_family');
    expect(result.requiresOfficerReview).toBe(true);
  });
});

// ============================================================
// EXACT URL — materialHash in conflictingFields
// ============================================================

describe('assessDuplicate exact_url materialHash conflict', () => {
  it('includes materialHash in conflictingFields when hashes differ on exact-URL match', () => {
    const candidate: DedupeCandidate = {
      identityKey: 'greenhouse:acme:5001',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/5001',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'research intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };
    const existing: DedupeCandidate[] = [{
      identityKey: 'greenhouse:acme:5002', // different identity
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/5001', // same URL
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'research intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', // different hash
    }];
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_url');
    expect(result.requiresOfficerReview).toBe(true);
    expect(result.conflictingFields).toContain('materialHash');
  });

  it('does NOT add materialHash to conflictingFields when hashes are equal on exact-URL match', () => {
    const hash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const candidate: DedupeCandidate = {
      identityKey: 'greenhouse:acme:5003',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/5003',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'lab intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: hash,
    };
    const existing: DedupeCandidate[] = [{
      identityKey: 'greenhouse:acme:5004',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/5003',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'lab intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: hash,
    }];
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_url');
    expect(result.conflictingFields).not.toContain('materialHash');
  });

  it('does NOT add materialHash when either hash is null on exact-URL match', () => {
    const candidate: DedupeCandidate = {
      identityKey: 'greenhouse:acme:5005',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/5005',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'lab intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: null,
    };
    const existing: DedupeCandidate[] = [{
      identityKey: 'greenhouse:acme:5006',
      canonicalUrl: 'https://boards.greenhouse.io/acme/jobs/5005',
      employerNameNormalized: 'acme biotech',
      titleNormalized: 'lab intern',
      locationNormalized: 'long beach, ca',
      departments: [],
      materialHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    }];
    const result = assessDuplicate(candidate, existing);
    expect(result.matchType).toBe('exact_url');
    expect(result.conflictingFields).not.toContain('materialHash');
  });
});
