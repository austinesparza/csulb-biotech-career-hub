/**
 * Pure duplicate assessment for the automated ingestion pipeline.
 *
 * Rules:
 * - Does not modify any records.
 * - Does not create new review-task taxonomy beyond Phase 1 approved task types.
 * - Does not automatically merge or publish records.
 * - Returns a typed DuplicateAssessment describing match classification, confidence,
 *   contributing fields, conflicting fields, reasons, and officer-review requirement.
 *
 * Match priority (highest to lowest):
 *   1. exact_identity       — same connector kind + board token + external posting ID
 *   2. exact_url            — same canonical URL (different identity)
 *   3. probable_same_posting — same employer + very similar title + same location
 *   4. possible_annual_family — same employer + title family (season/year stripped)
 *   5. likely_distinct       — fields differ enough
 *   6. insufficient_information — not enough data
 */

import type { DuplicateAssessment, IngestionMatchType } from './types';
import { toCaseInsensitiveKey, normalizeJobTitleFamily } from './normalize';

// ============================================================
// SIMILARITY
// ============================================================

/** Dice coefficient on character bigrams: 0..1. Pure, dependency-free. */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  let overlap = 0;
  for (const [bg, ca] of ma) overlap += Math.min(ca, mb.get(bg) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** Threshold for title similarity to qualify as "probable same posting". */
const TITLE_SIMILARITY_THRESHOLD = 0.85;

/** Threshold for employer-name similarity in probable-match assessment. */
const EMPLOYER_SIMILARITY_THRESHOLD = 0.85;

// ============================================================
// COMPARISON INPUT TYPES
// ============================================================

/** Minimal fields needed to assess deduplication. */
export interface DedupeCandidate {
  identityKey: string;
  canonicalUrl: string;
  employerNameNormalized: string | null;
  titleNormalized: string | null;
  locationNormalized: string | null;
  departments: string[];
}

// ============================================================
// ASSESSMENT
// ============================================================

/**
 * Assess whether candidate is a duplicate of any posting in existingPostings.
 *
 * Returns a DuplicateAssessment describing the closest match found.
 * When no postings are provided, returns insufficient_information.
 *
 * @param candidate        The new posting being assessed.
 * @param existingPostings Existing source_postings rows to compare against.
 *                         May be empty (first-ever fetch).
 */
export function assessDuplicate(
  candidate: DedupeCandidate,
  existingPostings: DedupeCandidate[],
): DuplicateAssessment {
  if (existingPostings.length === 0) {
    return {
      matchType: 'insufficient_information',
      confidence: 0,
      contributingFields: [],
      conflictingFields: [],
      reasons: ['No existing postings provided for comparison.'],
      requiresOfficerReview: false,
    };
  }

  // --- Priority 1: exact identity ---
  const exactId = existingPostings.find((p) => p.identityKey === candidate.identityKey);
  if (exactId) {
    const conflicting = findConflictingFields(candidate, exactId);
    return {
      matchType: 'exact_identity',
      confidence: 1.0,
      contributingFields: ['identityKey'],
      conflictingFields: conflicting,
      reasons: [
        `Identity key matches exactly: "${candidate.identityKey}".`,
        conflicting.length > 0
          ? `Material fields have changed: ${conflicting.join(', ')}.`
          : 'Content is unchanged.',
      ],
      requiresOfficerReview: conflicting.length > 0,
    };
  }

  // --- Priority 2: exact canonical URL ---
  const exactUrl = existingPostings.find(
    (p) => p.canonicalUrl === candidate.canonicalUrl,
  );
  if (exactUrl) {
    const conflicting = findConflictingFields(candidate, exactUrl);
    return {
      matchType: 'exact_url',
      confidence: 0.95,
      contributingFields: ['canonicalUrl'],
      conflictingFields: conflicting,
      reasons: [
        `Canonical URL matches: "${candidate.canonicalUrl}".`,
        'Identity keys differ — may be a re-posted or duplicated listing.',
        conflicting.length > 0
          ? `Field differences: ${conflicting.join(', ')}.`
          : 'Other fields match.',
      ],
      requiresOfficerReview: true,
    };
  }

  // --- Priority 3: probable same posting ---
  if (candidate.employerNameNormalized && candidate.titleNormalized) {
    for (const existing of existingPostings) {
      if (!existing.employerNameNormalized || !existing.titleNormalized) continue;

      const employerSim = bigramSimilarity(
        candidate.employerNameNormalized,
        existing.employerNameNormalized,
      );
      const titleSim = bigramSimilarity(
        candidate.titleNormalized,
        existing.titleNormalized,
      );

      if (
        employerSim >= EMPLOYER_SIMILARITY_THRESHOLD &&
        titleSim >= TITLE_SIMILARITY_THRESHOLD
      ) {
        const locationMatch =
          candidate.locationNormalized === existing.locationNormalized;
        const contributing = ['employerNameNormalized', 'titleNormalized'];
        if (locationMatch && candidate.locationNormalized) {
          contributing.push('locationNormalized');
        }
        const conflicting = findConflictingFields(candidate, existing);
        const confidence = Math.min(0.9, (employerSim + titleSim) / 2 + (locationMatch ? 0.05 : 0));
        return {
          matchType: 'probable_same_posting',
          confidence,
          contributingFields: contributing,
          conflictingFields: conflicting,
          reasons: [
            `Employer name similarity: ${(employerSim * 100).toFixed(0)}%.`,
            `Title similarity: ${(titleSim * 100).toFixed(0)}%.`,
            locationMatch
              ? `Location matches: "${candidate.locationNormalized}".`
              : `Location differs: "${candidate.locationNormalized}" vs "${existing.locationNormalized}".`,
          ],
          requiresOfficerReview: true,
        };
      }
    }
  }

  // --- Priority 4: possible annual family ---
  if (candidate.employerNameNormalized && candidate.titleNormalized) {
    const candidateFamily = normalizeJobTitleFamily(candidate.titleNormalized);
    for (const existing of existingPostings) {
      if (!existing.employerNameNormalized || !existing.titleNormalized) continue;
      const existingFamily = normalizeJobTitleFamily(existing.titleNormalized);
      if (!candidateFamily || !existingFamily) continue;

      const employerSim = bigramSimilarity(
        candidate.employerNameNormalized,
        existing.employerNameNormalized,
      );
      const familySim = bigramSimilarity(candidateFamily, existingFamily);

      if (employerSim >= EMPLOYER_SIMILARITY_THRESHOLD && familySim >= TITLE_SIMILARITY_THRESHOLD) {
        return {
          matchType: 'possible_annual_family',
          confidence: 0.6,
          contributingFields: ['employerNameNormalized', 'titleNormalized (family)'],
          conflictingFields: ['titleNormalized'],
          reasons: [
            `Same employer (${(employerSim * 100).toFixed(0)}% match).`,
            `Title family matches (${(familySim * 100).toFixed(0)}%) after stripping season/year.`,
            'Titles differ — likely a recurring annual program.',
          ],
          requiresOfficerReview: true,
        };
      }
    }
  }

  // --- Priority 5: likely distinct ---
  return {
    matchType: 'likely_distinct',
    confidence: 0.9,
    contributingFields: [],
    conflictingFields: [],
    reasons: ['No identity, URL, employer+title, or family match found across existing postings.'],
    requiresOfficerReview: false,
  };
}

/** Fields that indicate content differences when comparing two postings. */
const CONTENT_FIELDS: Array<keyof DedupeCandidate> = [
  'employerNameNormalized',
  'titleNormalized',
  'locationNormalized',
];

function findConflictingFields(a: DedupeCandidate, b: DedupeCandidate): string[] {
  return CONTENT_FIELDS.filter((f) => {
    const av = a[f];
    const bv = b[f];
    if (av === null && bv === null) return false;
    return toCaseInsensitiveKey(String(av ?? '')) !== toCaseInsensitiveKey(String(bv ?? ''));
  });
}
