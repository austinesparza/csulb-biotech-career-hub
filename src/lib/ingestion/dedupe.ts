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
 *   3. probable_same_posting — same employer + very similar title + same normalized location
 *                             (conflicting non-null location disqualifies probable match)
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
  /** Material hash from the normalized posting; null when not available. */
  materialHash: string | null;
}

// ============================================================
// BEST-MATCH RESULT (internal)
// ============================================================

interface ScoredMatch {
  existing: DedupeCandidate;
  matchType: IngestionMatchType;
  confidence: number;
  tieBreaker: string; // identityKey for deterministic ordering
}

// ============================================================
// ASSESSMENT
// ============================================================

/**
 * Assess whether candidate is a duplicate of any posting in existingPostings.
 *
 * Returns a DuplicateAssessment describing the closest match found.
 * Evaluates ALL existing postings and returns the BEST match, not the first match.
 * Tie-breaking is deterministic: when scores are equal, prefer the posting with
 * the lexicographically smallest identityKey.
 *
 * When no postings are provided, returns insufficient_information.
 * When candidate employer or title is missing, returns insufficient_information
 * for match types that require those fields.
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
      matchedIdentityKey: null,
      contributingFields: [],
      conflictingFields: [],
      reasons: ['No existing postings provided for comparison.'],
      requiresOfficerReview: false,
    };
  }

  // --- Priority 1: exact identity ---
  // Find best exact-identity match (there should be at most one, but be defensive)
  const exactIdMatches = existingPostings
    .filter((p) => p.identityKey === candidate.identityKey)
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  if (exactIdMatches.length > 0) {
    const exactId = exactIdMatches[0];
    const conflicting = findConflictingFields(candidate, exactId);
    const hashChanged =
      candidate.materialHash != null &&
      exactId.materialHash != null &&
      candidate.materialHash !== exactId.materialHash;
    const hashUnchanged =
      candidate.materialHash != null &&
      exactId.materialHash != null &&
      candidate.materialHash === exactId.materialHash;
    const contentReason = hashChanged
      ? `Material hash has changed (content was modified).`
      : hashUnchanged
      ? 'Material hash is unchanged (content not modified).'
      : conflicting.length > 0
      ? `Material fields have changed: ${conflicting.join(', ')}.`
      : 'No detectable content changes.';
    // Officer review required when materialHash changed, or when conflicting fields exist
    const requiresReview = hashChanged || (candidate.materialHash == null && conflicting.length > 0);
    return {
      matchType: 'exact_identity',
      confidence: 1.0,
      matchedIdentityKey: exactId.identityKey,
      contributingFields: ['identityKey'],
      conflictingFields: conflicting.length > 0 || hashChanged ? [...conflicting, ...(hashChanged && !conflicting.includes('materialHash') ? ['materialHash'] : [])] : [],
      reasons: [
        `Identity key matches exactly: "${candidate.identityKey}".`,
        contentReason,
      ],
      requiresOfficerReview: requiresReview,
    };
  }

  // --- Priority 2: exact canonical URL ---
  const exactUrlMatches = existingPostings
    .filter((p) => p.canonicalUrl === candidate.canonicalUrl)
    .sort((a, b) => a.identityKey.localeCompare(b.identityKey));

  if (exactUrlMatches.length > 0) {
    const exactUrl = exactUrlMatches[0];
    const conflicting = findConflictingFields(candidate, exactUrl);
    const urlHashChanged =
      candidate.materialHash != null &&
      exactUrl.materialHash != null &&
      candidate.materialHash !== exactUrl.materialHash;
    const allConflicting = urlHashChanged && !conflicting.includes('materialHash')
      ? [...conflicting, 'materialHash']
      : conflicting;
    return {
      matchType: 'exact_url',
      confidence: 0.95,
      matchedIdentityKey: exactUrl.identityKey,
      contributingFields: ['canonicalUrl'],
      conflictingFields: allConflicting,
      reasons: [
        `Canonical URL matches: "${candidate.canonicalUrl}".`,
        'Identity keys differ — may be a re-posted or duplicated listing.',
        allConflicting.length > 0
          ? `Field differences: ${allConflicting.join(', ')}.`
          : 'Other fields match.',
      ],
      requiresOfficerReview: true,
    };
  }

  // --- Priority 3: probable same posting ---
  // Requires: matching employer (≥85%), similar title (≥85%), AND same normalized location
  // (or both locations are null). A conflicting non-null location disqualifies this match type.
  if (candidate.employerNameNormalized && candidate.titleNormalized) {
    const probableMatches: ScoredMatch[] = [];
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
        // Location must match or both must be null; conflicting non-null location disqualifies
        const locationMatch =
          candidate.locationNormalized === existing.locationNormalized;
        const bothLocationsNull =
          candidate.locationNormalized == null && existing.locationNormalized == null;
        const locationConflict =
          !locationMatch && !bothLocationsNull;

        if (locationConflict) continue; // conflicting location — not probable same posting

        const confidence = Math.min(0.9, (employerSim + titleSim) / 2 + 0.05);
        probableMatches.push({
          existing,
          matchType: 'probable_same_posting',
          confidence,
          tieBreaker: existing.identityKey,
        });
      }
    }

    if (probableMatches.length > 0) {
      // Select best match: highest confidence, then lexicographically smallest identityKey
      probableMatches.sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        return a.tieBreaker.localeCompare(b.tieBreaker);
      });
      const best = probableMatches[0];
      const existing = best.existing;
      const employerSim = bigramSimilarity(candidate.employerNameNormalized, existing.employerNameNormalized ?? '');
      const titleSim = bigramSimilarity(candidate.titleNormalized, existing.titleNormalized ?? '');
      const locationMatch = candidate.locationNormalized === existing.locationNormalized;
      const contributing = ['employerNameNormalized', 'titleNormalized'];
      if (locationMatch && candidate.locationNormalized) {
        contributing.push('locationNormalized');
      }
      const conflicting = findConflictingFields(candidate, existing);
      return {
        matchType: 'probable_same_posting',
        confidence: best.confidence,
        matchedIdentityKey: existing.identityKey,
        contributingFields: contributing,
        conflictingFields: conflicting,
        reasons: [
          `Employer name similarity: ${(employerSim * 100).toFixed(0)}%.`,
          `Title similarity: ${(titleSim * 100).toFixed(0)}%.`,
          locationMatch
            ? `Location matches: "${candidate.locationNormalized}".`
            : 'Both locations are absent.',
        ],
        requiresOfficerReview: true,
      };
    }
  } else if (!candidate.employerNameNormalized || !candidate.titleNormalized) {
    // Missing required fields for probable/annual matching → insufficient information
    return {
      matchType: 'insufficient_information',
      confidence: 0,
      matchedIdentityKey: null,
      contributingFields: [],
      conflictingFields: [],
      reasons: [
        'Candidate is missing employer name or title; cannot assess probable duplicate.',
        ...(!candidate.employerNameNormalized ? ['employer_name_missing'] : []),
        ...(!candidate.titleNormalized ? ['title_missing'] : []),
      ],
      requiresOfficerReview: false,
    };
  }

  // --- Priority 4: possible annual family ---
  if (candidate.employerNameNormalized && candidate.titleNormalized) {
    const candidateFamily = normalizeJobTitleFamily(candidate.titleNormalized);
    const annualMatches: ScoredMatch[] = [];
    for (const existing of existingPostings) {
      if (!existing.employerNameNormalized || !existing.titleNormalized) continue;
      const existingFamily = normalizeJobTitleFamily(existing.titleNormalized);
      if (!candidateFamily || !existingFamily) continue;

      // Annual-family requires evidence that season/year/cycle markers were actually
      // removed or differ: the raw titles must not be identical (identical titles
      // in different cities are likely_distinct, not annual-family), and at least one
      // title must differ from its own family form (i.e., something was stripped).
      const titlesIdentical = candidate.titleNormalized === existing.titleNormalized;
      const candidateStripped = candidateFamily !== candidate.titleNormalized;
      const existingStripped = existingFamily !== existing.titleNormalized;
      if (titlesIdentical || (!candidateStripped && !existingStripped)) continue;

      // Location conflict disqualifies annual-family matches (same as probable_same_posting).
      const locationConflict =
        candidate.locationNormalized !== existing.locationNormalized &&
        candidate.locationNormalized != null &&
        existing.locationNormalized != null;
      if (locationConflict) continue;

      const employerSim = bigramSimilarity(
        candidate.employerNameNormalized,
        existing.employerNameNormalized,
      );
      const familySim = bigramSimilarity(candidateFamily, existingFamily);

      if (employerSim >= EMPLOYER_SIMILARITY_THRESHOLD && familySim >= TITLE_SIMILARITY_THRESHOLD) {
        annualMatches.push({
          existing,
          matchType: 'possible_annual_family',
          confidence: 0.6,
          tieBreaker: existing.identityKey,
        });
      }
    }
    if (annualMatches.length > 0) {
      // Deterministic tie-breaking by identityKey
      annualMatches.sort((a, b) => a.tieBreaker.localeCompare(b.tieBreaker));
      return {
        matchType: 'possible_annual_family',
        confidence: 0.6,
        matchedIdentityKey: annualMatches[0].existing.identityKey,
        contributingFields: ['employerNameNormalized', 'titleNormalized (family)'],
        conflictingFields: ['titleNormalized'],
        reasons: [
          `Same employer matched.`,
          `Title family matches after stripping season/year.`,
          'Titles differ — likely a recurring annual program.',
        ],
        requiresOfficerReview: true,
      };
    }
  }

  // --- Priority 5: likely distinct ---
  return {
    matchType: 'likely_distinct',
    confidence: 0.9,
    matchedIdentityKey: null,
    contributingFields: [],
    conflictingFields: [],
    reasons: ['No identity, URL, employer+title+location, or family match found across existing postings.'],
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
