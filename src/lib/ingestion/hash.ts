/**
 * Stable hashing utilities for the automated ingestion pipeline.
 *
 * All functions are deterministic:
 * - stableSerialize produces identical output regardless of object key insertion order.
 * - sha256Hex always produces a 64-character lowercase hexadecimal string.
 * - makeGreenhouseIdentityKey produces the same key for the same logical posting
 *   regardless of content, title, location, or fetch-time changes.
 * - makeMaterialHash changes only when officer-review-relevant fields change.
 *
 * Uses Node.js built-in `crypto` module (available in Next.js server runtime
 * and in Vitest test environment). Does not use the Web Crypto API to avoid
 * the async/await requirement in Node 18+.
 */

import { createHash } from 'crypto';

// ============================================================
// STABLE JSON SERIALIZATION
// ============================================================

/**
 * Serialize a value to JSON with recursively sorted object keys.
 * This produces identical output regardless of object key insertion order,
 * making it safe to use as input to a content hash.
 *
 * Rules:
 * - Object keys are sorted lexicographically (ascending).
 * - Arrays preserve element order.
 * - null, boolean, number, and string primitives are passed through.
 * - undefined values are serialized as null (consistent with JSON.stringify behavior).
 * - No pretty-printing (compact output for hashing).
 */
export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortedValue(value));
}

function sortedValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortedValue);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortedValue(obj[key]);
    }
    return sorted;
  }
  // For other types (e.g. functions), return null to avoid non-determinism.
  return null;
}

// ============================================================
// SHA-256 HASH
// ============================================================

/**
 * Compute the SHA-256 hash of a UTF-8 string.
 * Returns exactly 64 lowercase hexadecimal characters.
 *
 * Satisfies the database constraint:
 *   check (material_hash ~ '^[0-9a-f]{64}$')
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').toLowerCase();
}

// ============================================================
// IDENTITY KEY
// ============================================================

/**
 * Produce a stable identity key for a Greenhouse job posting.
 *
 * Algorithm:
 *   `greenhouse:{boardToken}:{jobPostId}`
 *
 * Properties:
 * - Stable across changes to title, location, content, or fetch time.
 * - Unique per (connector kind, board token, Greenhouse job-post ID) triple.
 * - boardToken and jobPostId are lowercased and trimmed to avoid case drift.
 *
 * @param boardToken  The Greenhouse board token (e.g. "mycompany").
 * @param jobPostId   The Greenhouse job post ID (numeric string, e.g. "12345").
 */
export function makeGreenhouseIdentityKey(boardToken: string, jobPostId: string): string {
  return `greenhouse:${boardToken.toLowerCase().trim()}:${String(jobPostId).trim()}`;
}

// ============================================================
// MATERIAL HASH
// ============================================================

/**
 * Fields included in the Greenhouse material hash.
 *
 * A change to ANY of these fields triggers an is_material_change event and
 * requires officer review (via import_changed review task in the DB layer).
 *
 * Included fields (all from the normalized posting, derived from source):
 *   - titleRaw           Job title as fetched (primary identity signal)
 *   - locationRaw        Location as fetched
 *   - canonicalUrl       Full URL to the posting
 *   - departments        Sorted array of department names
 *   - offices            Sorted array of office names
 *   - closesAt           Parsed application deadline (ISO date or null)
 *   - deadlineKind       Interpretation of the deadline (hard / rolling / unknown)
 *
 * Excluded fields (non-material — do NOT add these to the hash):
 *   - identityKey        Identity itself, not content
 *   - fetchedAt          Fetch timestamp (changes every run by design)
 *   - relevanceScore     Computed, not sourced
 *   - scoreBreakdown     Computed, not sourced
 *   - uncertaintyFlags   Computed, not sourced
 *   - connectorVersion   Infrastructure version, not content
 *   - materialHash       Circular
 *   - internalJobId      Greenhouse internal ID — changes only with back-end
 *                        restructuring, not meaningful job content
 *   - language           Locale metadata, not material content
 *   - externalPostingId  Part of identity, not content
 *   - requisitionId      Internal HR tracking; changes do not indicate public
 *                        content change
 */
export interface GreenhouseMaterialFields {
  titleRaw: string | null;
  locationRaw: string | null;
  canonicalUrl: string;
  departments: string[]; // sorted
  offices: string[];     // sorted
  closesAt: string | null;
  deadlineKind: string;
}

/**
 * Compute the material hash for a Greenhouse posting.
 *
 * @param fields  The material fields extracted from the normalized posting.
 * @returns       64-character lowercase hexadecimal SHA-256.
 */
export function makeGreenhouseMaterialHash(fields: GreenhouseMaterialFields): string {
  const normalized: GreenhouseMaterialFields = {
    titleRaw: fields.titleRaw,
    locationRaw: fields.locationRaw,
    canonicalUrl: fields.canonicalUrl,
    departments: [...fields.departments].sort(),
    offices: [...fields.offices].sort(),
    closesAt: fields.closesAt,
    deadlineKind: fields.deadlineKind,
  };
  return sha256Hex(stableSerialize(normalized));
}
