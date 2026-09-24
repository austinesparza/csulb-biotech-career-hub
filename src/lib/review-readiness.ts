import type { AudienceBucket, GraduateStage } from './types';
import { isPublishableAudienceStage } from './opportunityAudience';
import { hasRecentOpenSource } from './review-source';
import { validateEmployerControlledSourceUrl } from './discovery-promotion';

export interface ReviewReadinessInput {
  postingUrl: string | null;
  audienceBucket: AudienceBucket;
  audienceReason: string | null;
  graduateStage: GraduateStage;
  sourceCheckResult: string | null;
  lastCheckedAt: string | null;
}

export type ReviewReadinessBucket = 'decision-ready' | 'needs-confirmation' | 'outside-board';

const OUTSIDE_BOARD = new Set<AudienceBucket>(['special', 'adjacent', 'ineligible']);

/**
 * Triage only. This never grants publication authority; it just organizes the
 * private officer queue so records with complete audience evidence appear first.
 */
export function reviewReadinessBucket(input: ReviewReadinessInput, now: Date = new Date()): ReviewReadinessBucket {
  if (OUTSIDE_BOARD.has(input.audienceBucket)) return 'outside-board';

  const ready = Boolean(input.postingUrl?.trim())
    && validateEmployerControlledSourceUrl(input.postingUrl ?? '').valid
    && hasRecentOpenSource(input.sourceCheckResult, input.lastCheckedAt, now)
    && ['undergraduate', 'graduate', 'mixed'].includes(input.audienceBucket)
    && isPublishableAudienceStage(input.audienceBucket, input.graduateStage)
    && (input.audienceReason?.trim().length ?? 0) >= 8;

  return ready ? 'decision-ready' : 'needs-confirmation';
}
