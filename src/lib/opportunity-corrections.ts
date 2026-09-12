import { makeFamilyKey, makeStrictKey } from './csvImport';
import { cleanText, normalizeUrl } from './normalize';
import type { AudienceBucket, GraduateStage, PaidStatus } from './types';
import { isPublishableAudienceStage } from './opportunityAudience';

export interface OpportunityCorrectionDraft {
  title: string;
  postingUrl: string;
  location: string;
  eligibility: string;
  focusArea: string;
  deadline: string;
  deadlineText: string;
  startDateText: string;
  paidStatus: PaidStatus;
  applicationType: string;
  status: 'open_verified' | 'open_unverified';
  publicNotes: string;
  audienceBucket: AudienceBucket;
  audienceReason: string;
  graduateStage: GraduateStage;
  eligibilityEvidence: string;
  workAuthorization: string;
}

const PAID_STATUSES = new Set<PaidStatus>(['paid', 'unpaid', 'stipend', 'unknown']);

function isIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function boundedText(value: string, label: string, max: number): string | null {
  const cleaned = cleanText(value);
  if (cleaned && cleaned.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return cleaned;
}

export function validateRevisionReason(value: string): string {
  const reason = cleanText(value);
  if (!reason || reason.length < 8) throw new Error('Explain the correction in at least 8 characters');
  if (reason.length > 500) throw new Error('Correction reason must be 500 characters or fewer');
  return reason;
}

export function buildPublishedCorrection(
  draft: OpportunityCorrectionDraft,
  companyName: string,
): Record<string, string | null> {
  const title = boundedText(draft.title, 'Title', 300);
  if (!title || title.length < 2) throw new Error('Title must be at least 2 characters');

  const rawUrl = draft.postingUrl.trim();
  const postingUrl = rawUrl ? normalizeUrl(rawUrl) : null;
  if (rawUrl && !postingUrl) throw new Error('Posting URL must be a valid http(s) link');

  const deadline = draft.deadline.trim();
  if (deadline && !isIsoDate(deadline)) {
    throw new Error('Deadline must be a valid date in YYYY-MM-DD format');
  }
  if (!isPublishableAudienceStage(draft.audienceBucket, draft.graduateStage)) {
    throw new Error('Choose the student audience and stage supported by the posting');
  }
  if (!PAID_STATUSES.has(draft.paidStatus)) throw new Error('Invalid paid status');
  if (!['open_verified', 'open_unverified'].includes(draft.status)) throw new Error('Invalid public status');

  const audienceReason = boundedText(draft.audienceReason, 'Audience evidence', 500);
  if (!audienceReason || audienceReason.length < 8) {
    throw new Error('Audience evidence must be at least 8 characters');
  }

  return {
    title,
    posting_url: postingUrl,
    location: boundedText(draft.location, 'Location', 500),
    eligibility: boundedText(draft.eligibility, 'Eligibility', 2_000),
    focus_area: boundedText(draft.focusArea, 'Focus area', 500),
    deadline: deadline || null,
    deadline_text: boundedText(draft.deadlineText, 'Deadline note', 500),
    start_date_text: boundedText(draft.startDateText, 'Start date or duration', 500),
    paid_status: draft.paidStatus,
    application_type: boundedText(draft.applicationType, 'Application type', 500),
    status: draft.status,
    public_notes: boundedText(draft.publicNotes, 'Public note', 500),
    audience_bucket: draft.audienceBucket,
    audience_reason: audienceReason,
    graduate_stage: draft.graduateStage,
    eligibility_evidence: boundedText(draft.eligibilityEvidence, 'Eligibility evidence', 2_000),
    work_authorization: boundedText(draft.workAuthorization, 'Work authorization', 1_000),
    dedupe_key: makeStrictKey(companyName, title, postingUrl),
    family_key: makeFamilyKey(companyName, title),
  };
}
