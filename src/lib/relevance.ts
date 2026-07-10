// Deliverable I — relevance scoring. Rule-based, transparent, 0–100.
// The score sorts lists; it NEVER hides records or bypasses review.
// Officers can read `reasons` to see exactly why a score is what it is.

import type { OpportunityDraft, PaidStatus } from './types';

export interface ScoringConfig {
  /** Focus areas the club prioritizes; matched case-insensitively as substrings. */
  priorityFocusAreas: string[];
  /** Substrings that indicate a local/accessible location. */
  localLocationHints: string[];
  /** Eligibility substrings that match the club's members. */
  eligibilityHints: string[];
}

/** Tune this in one place; document changes in HANDOFF.md. */
export const DEFAULT_CONFIG: ScoringConfig = {
  priorityFocusAreas: [], // e.g. filled in by officers via admin settings later
  localLocationHints: ['long beach', 'los angeles', 'orange county', 'irvine', 'carson', 'torrance', 'remote', 'hybrid', 'california', 'ca'],
  eligibilityHints: ['undergraduate', 'undergrad', 'bachelor', 'junior', 'senior', 'sophomore', 'freshman', 'all majors', 'students'],
};

export interface ScoreResult {
  score: number;       // 0..100
  reasons: string[];   // human-readable, stored in relevance_reasons
}

export function scoreOpportunity(
  draft: Pick<
    OpportunityDraft,
    'deadline' | 'deadline_text' | 'paid_status' | 'location' | 'eligibility' | 'focus_area' | 'posting_url'
  >,
  config: ScoringConfig = DEFAULT_CONFIG,
  now: Date = new Date(),
): ScoreResult {
  let score = 40; // neutral baseline
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${points > 0 ? '+' : ''}${points}: ${reason}`);
  };

  // Deadline
  if (draft.deadline) {
    const days = Math.floor((Date.parse(draft.deadline) - now.getTime()) / 86_400_000);
    if (days < 0) add(-30, `deadline passed ${-days}d ago`);
    else if (days <= 7) add(5, `deadline in ${days}d (urgent but applicable)`);
    else if (days <= 60) add(15, `deadline in ${days}d`);
    else add(10, `deadline in ${days}d (plenty of time)`);
  } else if (draft.deadline_text && /rolling|ongoing|until filled/i.test(draft.deadline_text)) {
    add(10, 'rolling deadline');
  } else {
    add(-5, 'no deadline information');
  }

  // Compensation
  const paidPoints: Record<PaidStatus, [number, string]> = {
    paid: [15, 'paid position'],
    stipend: [10, 'stipend offered'],
    unknown: [0, 'compensation unknown'],
    unpaid: [-5, 'unpaid'],
  };
  const [pp, pr] = paidPoints[draft.paid_status];
  if (pp !== 0) add(pp, pr);

  // Location
  const loc = (draft.location ?? '').toLowerCase();
  if (loc && config.localLocationHints.some((h) => loc.includes(h))) {
    add(10, `accessible location (${draft.location})`);
  } else if (!loc) {
    add(-3, 'no location listed');
  }

  // Eligibility
  const elig = (draft.eligibility ?? '').toLowerCase();
  if (elig && config.eligibilityHints.some((h) => elig.includes(h))) {
    add(10, 'eligibility matches undergraduates');
  }
  if (/graduate students? only|phd only|masters? only/i.test(elig)) {
    add(-15, 'restricted to graduate students');
  }

  // Focus area priority (club-configurable)
  const focus = (draft.focus_area ?? '').toLowerCase();
  if (focus && config.priorityFocusAreas.some((f) => focus.includes(f.toLowerCase()))) {
    add(10, `priority focus area (${draft.focus_area})`);
  }

  // Link quality
  if (!draft.posting_url) add(-10, 'no application link');

  return { score: Math.max(0, Math.min(100, score)), reasons };
}
