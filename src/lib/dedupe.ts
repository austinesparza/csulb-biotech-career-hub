// Deliverable H (implementation) — deduplication.
// Policy:
//   - Only same-URL or strict-key matches may automatically update a row.
//   - Family (season/year-stripped) and fuzzy matches only FLAG for review.
//   - Approved+public records are NEVER field-mutated by imports (see
//     decideUpdatePolicy) — a routine re-import must not silently alter
//     listings an officer already reviewed.
//   - Nothing is ever auto-deleted or auto-merged.

import { normalizeCompanyName } from './normalize';

/** Dice coefficient on character bigrams: 0..1. Cheap and dependency-free. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
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

export const COMPANY_FUZZY_THRESHOLD = 0.85;
export const OPPORTUNITY_FUZZY_THRESHOLD = 0.8;

export type CompanyMatch =
  | { kind: 'exact'; companyId: string }
  | { kind: 'fuzzy'; companyId: string; score: number; existingName: string }
  | { kind: 'none' };

/**
 * Match an incoming company name against existing companies.
 * `existing` is the full (id, name_normalized, name) list — fine at club scale
 * (hundreds of rows); revisit only if the table exceeds ~10k.
 */
export function matchCompany(
  incomingName: string,
  existing: Array<{ id: string; name_normalized: string; name: string }>,
): CompanyMatch {
  const norm = normalizeCompanyName(incomingName);
  const exact = existing.find((c) => c.name_normalized === norm);
  if (exact) return { kind: 'exact', companyId: exact.id };

  let best: { c: (typeof existing)[number]; score: number } | null = null;
  for (const c of existing) {
    const score = similarity(norm, c.name_normalized);
    if (score >= COMPANY_FUZZY_THRESHOLD && (!best || score > best.score)) best = { c, score };
  }
  if (best) return { kind: 'fuzzy', companyId: best.c.id, score: best.score, existingName: best.c.name };
  return { kind: 'none' };
}

export interface ExistingOpportunity {
  id: string;
  dedupe_key: string | null;
  family_key: string | null;
  posting_url: string | null;
  title: string;
  company_id: string | null;
  review_status: string;
  public_safe: boolean;
}

export type OpportunityMatch =
  | { kind: 'same_url'; opportunityId: string }             // may auto-update (policy below)
  | { kind: 'strict_key'; opportunityId: string }           // may auto-update (policy below)
  | { kind: 'family'; opportunityId: string }               // FLAG possible_repost only
  | { kind: 'fuzzy'; opportunityId: string; score: number } // FLAG possible_duplicate only
  | { kind: 'none' };

/**
 * Priority order matters: URL first (strongest identity signal), then strict
 * key. Family/fuzzy come last and never trigger automatic updates.
 */
export function matchOpportunity(
  draft: { dedupe_key: string; family_key: string; posting_url: string | null; title: string; companyId: string | null },
  existing: ExistingOpportunity[],
): OpportunityMatch {
  if (draft.posting_url) {
    const byUrl = existing.find((o) => o.posting_url === draft.posting_url);
    if (byUrl) return { kind: 'same_url', opportunityId: byUrl.id };
  }

  const byKey = existing.find((o) => o.dedupe_key === draft.dedupe_key);
  if (byKey) return { kind: 'strict_key', opportunityId: byKey.id };

  const byFamily = existing.find((o) => o.family_key === draft.family_key);
  if (byFamily) return { kind: 'family', opportunityId: byFamily.id };

  // Fuzzy title match only within the same company (avoids cross-company noise).
  if (draft.companyId) {
    const sameCompany = existing.filter((o) => o.company_id === draft.companyId);
    let best: { id: string; score: number } | null = null;
    for (const o of sameCompany) {
      const score = similarity(draft.title.toLowerCase(), o.title.toLowerCase());
      if (score >= OPPORTUNITY_FUZZY_THRESHOLD && (!best || score > best.score)) {
        best = { id: o.id, score };
      }
    }
    if (best) return { kind: 'fuzzy', opportunityId: best.id, score: best.score };
  }
  return { kind: 'none' };
}

export type UpdatePolicy =
  | { mode: 'update_fields' }       // safe: record not yet public
  | { mode: 'touch_and_flag' };     // approved+public: last_seen_at only; flag changes

/**
 * The approved-record protection rule (audit patch 3):
 * a record that officers approved and published may only get its
 * last_seen_at refreshed by an import. Any changed public-facing field
 * results in an import_changed review task instead of a silent mutation.
 */
export function decideUpdatePolicy(existing: Pick<ExistingOpportunity, 'review_status' | 'public_safe'>): UpdatePolicy {
  if (existing.review_status === 'approved' && existing.public_safe) {
    return { mode: 'touch_and_flag' };
  }
  return { mode: 'update_fields' };
}

/** Public-facing fields whose change on an approved record must be flagged. */
export const FLAGGED_FIELDS = [
  'title', 'posting_url', 'location', 'eligibility', 'focus_area',
  'deadline', 'deadline_text', 'paid_status', 'application_type', 'source_status_raw',
] as const;

export function changedFlaggedFields(
  draft: Record<string, unknown>,
  existing: Record<string, unknown>,
): string[] {
  return FLAGGED_FIELDS.filter((f) => (draft[f] ?? null) !== (existing[f] ?? null));
}
