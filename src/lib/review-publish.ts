import type { AudienceBucket, GraduateStage } from './types';
import type { SheetReviewIntent } from './sheet-review';
import { isPublishableAudienceStage } from './opportunityAudience';
import { hasRecentOpenSource } from './review-source';
import { validateEmployerControlledSourceUrl } from './discovery-promotion';

export interface SheetPublishCandidateInput {
  postingUrl: string | null;
  audienceBucket: AudienceBucket;
  audienceReason: string | null;
  graduateStage: GraduateStage;
  sheetReview: SheetReviewIntent | null;
  sourceCheckResult: string | null;
  lastCheckedAt: string | null;
}

export type SheetPublishResolution =
  | {
      ready: true;
      audienceBucket: Extract<AudienceBucket, 'undergraduate' | 'graduate' | 'mixed'>;
      audienceReason: string;
      graduateStage: GraduateStage;
    }
  | { ready: false; reason: string };

const PUBLIC_AUDIENCES = new Set<AudienceBucket>(['undergraduate', 'graduate', 'mixed']);

/**
 * Resolve the final publication defaults for a record that has already been
 * reviewed in the governed Sheet. The Sheet remains review intent only; an
 * authenticated portal action must still perform the publication decision.
 */
export function resolveSheetPublishCandidate(input: SheetPublishCandidateInput, now: Date = new Date()): SheetPublishResolution {
  const sheet = input.sheetReview;
  if (sheet?.decision !== 'approve') {
    return { ready: false, reason: 'Sheet decision is not Approve' };
  }
  if (!sheet.publicSafe) {
    return { ready: false, reason: 'Public Safe is not checked in the Sheet' };
  }
  if (!input.postingUrl?.trim()) {
    return { ready: false, reason: 'Official posting URL is missing' };
  }
  const employerUrl = validateEmployerControlledSourceUrl(input.postingUrl);
  if (!employerUrl.valid) return { ready: false, reason: employerUrl.reason };
  if (!hasRecentOpenSource(input.sourceCheckResult, input.lastCheckedAt, now)) {
    return { ready: false, reason: 'A recorded open employer-source check within seven days is required; verify this posting individually in officer review' };
  }

  const audienceBucket = input.audienceBucket !== 'unknown'
    ? input.audienceBucket
    : sheet.audienceBucket;
  const graduateStage = input.graduateStage !== 'unknown'
    ? input.graduateStage
    : sheet.graduateStage;
  const audienceReason = input.audienceReason?.trim()
    ? input.audienceReason.trim()
    : sheet.audienceReason.trim();

  if (!PUBLIC_AUDIENCES.has(audienceBucket)) {
    return { ready: false, reason: 'Audience is not eligible for the public student board' };
  }
  if (!isPublishableAudienceStage(audienceBucket, graduateStage)) {
    return { ready: false, reason: 'Student stage is not publishable for the selected audience' };
  }
  if (audienceReason.length < 8) {
    return { ready: false, reason: 'Audience evidence is incomplete' };
  }

  return {
    ready: true,
    audienceBucket: audienceBucket as Extract<AudienceBucket, 'undergraduate' | 'graduate' | 'mixed'>,
    audienceReason,
    graduateStage,
  };
}
