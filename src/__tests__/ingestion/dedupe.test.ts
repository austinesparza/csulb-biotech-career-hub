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
      }];
      const candidate: DedupeCandidate = {
        identityKey: 'greenhouse:labgenomicsinc:3333333',
        canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/3333333',
        employerNameNormalized: 'lab genomics',
        titleNormalized: 'summer 2026 biotech internship program',
        locationNormalized: 'long beach, ca',
        departments: ['Research & Development'],
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
