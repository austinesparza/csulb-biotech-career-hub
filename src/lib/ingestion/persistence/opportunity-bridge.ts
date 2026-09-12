import 'server-only';

import { makeFamilyKey, makeStrictKey } from '../../csvImport';
import {
  changedFlaggedFields,
  decideUpdatePolicy,
  matchOpportunity,
  type ExistingOpportunity,
} from '../../dedupe';
import type { PersistedLinkMatchType, NormalizedSourcePosting } from '../types';
import { ensureOpenSourceReviewTask } from './review-tasks';
import { classifyScoringInput } from '../score';
import type { AudienceBucket, GraduateStage, PaidStatus } from '../../types';
import type {
  IngestionRepository,
  JobSourceRow,
  OpportunityRow,
  SourcePostingRow,
} from './repository';

export const PENDING_OPPORTUNITY_MIN_SCORE = 35;

const ELIGIBILITY_SIGNAL = /\b(master(?:'s|s)|master(?: degree| students?| program| candidates?)|m\.?s\.?c?|graduate students?|graduate degree|bachelor'?s?|undergraduate|post[ -]?baccalaureate|postbac|ph\.?d\.?|doctoral|degree program|currently enrolled|pursuing an? (?:advanced|graduate) degree)\b/i;
const WORK_AUTHORIZATION_SIGNAL = /\b(work authorization|authorized to work|visa sponsorship|sponsorship|citizenship|required citizen|permanent resident|cpt|opt)\b/i;
const CONTINUED_ENROLLMENT_SIGNAL = /\b(return(?:ing)? to (?:school|college|university|the program)|remain enrolled|continued? enrollment|continuing (?:their|your) (?:degree|studies|education)|enrolled .* (?:after|following) (?:the )?(?:internship|co-op))\b/i;

function sourceSnippets(text: string | null, signal: RegExp, limit = 3): string[] {
  if (!text?.trim()) return [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\s*[•▪◦]\s*/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const matches = sentences.filter((sentence) => signal.test(sentence));
  const candidates = matches.length > 0 ? matches : [text.replace(/\s+/g, ' ').trim()];
  const snippets: string[] = [];

  for (const candidate of candidates) {
    const match = candidate.match(signal);
    if (!match?.index && match?.index !== 0) continue;
    const start = Math.max(0, match.index - 140);
    const end = Math.min(candidate.length, match.index + match[0].length + 180);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < candidate.length ? '…' : '';
    const snippet = `${prefix}${candidate.slice(start, end).trim()}${suffix}`;
    if (!snippets.includes(snippet)) snippets.push(snippet);
    if (snippets.length >= limit) break;
  }
  return snippets;
}

function mapGraduateStage(stageId: string): GraduateStage {
  if (stageId === 'msc_year1') return 'msc_year_1';
  if (stageId === 'msc_year2') return 'msc_year_2';
  if (stageId === 'msc_any') return 'msc_any';
  if (stageId === 'phd_only') return 'doctoral_only';
  if (stageId === 'undergrad_only' || stageId === 'postbac_stage') return 'not_msc';
  return 'unknown';
}

function mapAudienceBucket(
  suggestedBucket: ReturnType<typeof classifyScoringInput>['suggestedBucket'],
  stageId: string,
  evidence: string | null,
): AudienceBucket {
  if (
    evidence
    && /\bmaster(?:'s|s)?\b|\bgraduate students?\b/i.test(evidence)
    && /\bbachelor'?s?\b|\bundergraduate\b|\bpost[ -]?baccalaureate\b|\bpostbac\b/i.test(evidence)
  ) {
    return 'mixed';
  }
  if (suggestedBucket === 'graduate') {
    return evidence && /\bbachelor'?s?|\bundergraduate\b|\bpost[ -]?baccalaureate\b|\bpostbac\b/i.test(evidence) ? 'mixed' : 'graduate';
  }
  if (suggestedBucket === 'special') return 'special';
  if (suggestedBucket === 'adjacent') return 'adjacent';
  if (suggestedBucket === 'excluded') return stageId === 'undergrad_only' ? 'undergraduate' : 'ineligible';
  return 'unknown';
}

function inferPaidStatus(text: string | null): PaidStatus {
  if (!text) return 'unknown';
  if (/\bunpaid\b/i.test(text)) return 'unpaid';
  if (/\bstipend(?:ed)?\b/i.test(text)) return 'stipend';
  if (/\bpaid (?:internship|co-op|position|opportunity)\b|\b(?:hourly|salary|pay|compensation) (?:rate|range)\b|\$\s?\d/i.test(text)) return 'paid';
  return 'unknown';
}

export function deriveOpportunityEnrichment(posting: NormalizedSourcePosting) {
  const classification = classifyScoringInput({
    employerName: posting.employerNameRaw ?? posting.employerNameNormalized,
    titleRaw: posting.titleRaw,
    titleNormalized: posting.titleNormalized,
    locationNormalized: posting.locationNormalized,
    department: posting.department,
    departments: posting.departments,
    classification: posting.classification,
    remoteType: posting.remoteType,
    canonicalUrl: posting.canonicalUrl,
    descriptionText: posting.descriptionText,
    closesAt: posting.closesAt,
    uncertaintyFlags: posting.uncertaintyFlags,
  });
  const eligibilityEvidence = sourceSnippets(posting.descriptionText, ELIGIBILITY_SIGNAL).join(' | ') || null;
  const workAuthorization = sourceSnippets(posting.descriptionText, WORK_AUTHORIZATION_SIGNAL, 2).join(' | ') || null;
  const continuedEnrollmentEvidence = sourceSnippets(posting.descriptionText, CONTINUED_ENROLLMENT_SIGNAL, 1);
  const graduateStage = mapGraduateStage(classification.stage.id);
  const audienceBucket = classification.keep
    ? mapAudienceBucket(classification.suggestedBucket, classification.stage.id, eligibilityEvidence)
    : 'unknown';
  const eligibilityStatus = !classification.stage.eligible
    ? 'not_eligible' as const
    : eligibilityEvidence && graduateStage !== 'unknown'
      ? 'possible' as const
      : 'unknown' as const;
  const methods = [...new Set([
    ...classification.methods.wet_lab,
    ...classification.methods.dry_lab,
    ...classification.methods.stats,
  ])];

  const deadlinePassed = posting.uncertaintyFlags.includes('deadline_past');
  return {
    eligibility: eligibilityEvidence,
    paidStatus: inferPaidStatus(posting.descriptionText),
    audienceBucket,
    audienceReason: eligibilityEvidence
      ? `${classification.stage.label}: ${eligibilityEvidence}`
      : 'Graduate access is not stated clearly in the authoritative source; officer verification is required.',
    scientificLanes: classification.lanes.map((lane) => lane.label),
    jobFunctions: classification.functions.map((jobFunction) => jobFunction.label),
    methods,
    graduateStage,
    eligibilityStatus,
    eligibilityEvidence,
    continuedEnrollmentRequired: continuedEnrollmentEvidence.length > 0 ? true : null,
    workAuthorization,
    applicationOpenedAt: posting.postedAt,
    lastCheckedAt: posting.fetchedAt,
    sourceCheckResult: deadlinePassed ? 'closed' as const : 'open' as const,
    discoveryRoute: 'official_feed' as const,
  };
}

function postingToDraft(posting: NormalizedSourcePosting, companyId: string | null) {
  const title = posting.titleRaw ?? posting.titleNormalized ?? 'Untitled opportunity';
  const dedupeKey = makeStrictKey(
    posting.employerNameRaw ?? posting.employerNameNormalized ?? 'unknown-company',
    title,
    posting.canonicalUrl,
  );
  const familyKey = makeFamilyKey(
    posting.employerNameRaw ?? posting.employerNameNormalized ?? 'unknown-company',
    title,
  );

  return {
    title,
    posting_url: posting.canonicalUrl,
    location: posting.locationRaw,
    ...deriveOpportunityEnrichment(posting),
    focus_area: posting.focusArea,
    deadline: posting.closesAt,
    deadline_text: posting.deadlineEvidence ?? posting.closesAt,
    paid_status: inferPaidStatus(posting.descriptionText),
    application_type: posting.employmentType,
    source_status_raw: posting.uncertaintyFlags.includes('deadline_past') ? 'deadline_passed' : 'open',
    dedupe_key: dedupeKey,
    family_key: familyKey,
    companyId,
  };
}

function mapMatchTypeToLinkType(kind: ReturnType<typeof matchOpportunity>['kind']): PersistedLinkMatchType {
  if (kind === 'same_url' || kind === 'strict_key') return 'exact';
  if (kind === 'family') return 'annual_family';
  if (kind === 'fuzzy') return 'probable';
  return 'alternate_source';
}

function toExistingOpportunity(row: OpportunityRow): ExistingOpportunity {
  return {
    id: row.id,
    dedupe_key: row.dedupe_key,
    family_key: row.family_key,
    posting_url: row.posting_url,
    title: row.title,
    company_id: row.company_id,
    review_status: row.review_status,
    public_safe: row.public_safe,
  };
}

function canAutoMutateDraft(opportunity: OpportunityRow): boolean {
  if (opportunity.review_status === 'rejected' || opportunity.review_status === 'approved') return false;
  const protectedStatuses = [
    'closed', 'expired', 'broken_link',
    'hidden', 'duplicate', 'not_relevant', 'archive_only',
  ];
  if (protectedStatuses.includes(opportunity.status)) return false;
  return true;
}

async function ensureLink(params: {
  repository: IngestionRepository;
  opportunityId: string;
  sourcePostingId: string;
  matchType: PersistedLinkMatchType;
  requestPrimary: boolean;
}) {
  const existing = await params.repository.getLink(params.opportunityId, params.sourcePostingId);
  if (existing) return existing;

  let isPrimary = false;
  if (params.requestPrimary) {
    const currentPrimary = await params.repository.getPrimaryLink(params.opportunityId);
    isPrimary = !currentPrimary;
  }

  return params.repository.insertLink({
    opportunityId: params.opportunityId,
    sourcePostingId: params.sourcePostingId,
    matchType: params.matchType,
    isPrimary,
  });
}

export interface OpportunityBridgeResult {
  createdPendingOpportunityId: string | null;
  linkedOpportunityId: string | null;
  linkMatchType: PersistedLinkMatchType | null;
  protectedApprovedOpportunity: boolean;
}

export async function bridgeOpportunityForSourcePosting(params: {
  repository: IngestionRepository;
  jobSource: JobSourceRow;
  sourcePosting: SourcePostingRow;
  posting: NormalizedSourcePosting;
  materialChanged: boolean;
}): Promise<OpportunityBridgeResult> {
  const { repository, jobSource, sourcePosting, posting, materialChanged } = params;
  const companyResolution = await repository.resolveCompanyId(jobSource, posting.employerNameRaw, posting.employerNameNormalized);
  const draft = postingToDraft(posting, companyResolution.companyId);

  const existingOpportunities = await repository.listMatchableOpportunities();
  const match = matchOpportunity(draft, existingOpportunities.map(toExistingOpportunity));

  let linkedOpportunity: OpportunityRow | null = null;
  let matchType: PersistedLinkMatchType | null = null;
  let protectedApproved = false;
  let createdPendingOpportunityId: string | null = null;

  if (match.kind === 'same_url' || match.kind === 'strict_key' || match.kind === 'family' || match.kind === 'fuzzy') {
    linkedOpportunity = await repository.findOpportunityById(match.opportunityId);
    if (linkedOpportunity) {
      if (match.kind === 'family' || match.kind === 'fuzzy') {
        await repository.updateOpportunityObservation(linkedOpportunity.id, posting.fetchedAt);
        await ensureOpenSourceReviewTask({
          repository,
          taskType: match.kind === 'family' ? 'possible_repost' : 'possible_duplicate',
          entityTable: 'opportunities',
          entityId: linkedOpportunity.id,
          materialHash: sourcePosting.last_material_hash,
          noteTag: match.kind,
          noteBody: `${match.kind === 'family' ? 'Family-key' : 'Fuzzy'} match requires officer review before treating records as same opportunity.`,
        });

        matchType = mapMatchTypeToLinkType(match.kind);
        await ensureLink({
          repository,
          opportunityId: linkedOpportunity.id,
          sourcePostingId: sourcePosting.id,
          matchType,
          requestPrimary: false,
        });
      } else {
        const policy = decideUpdatePolicy(linkedOpportunity);
        const mayMutate = canAutoMutateDraft(linkedOpportunity) && policy.mode === 'update_fields';

        if (!mayMutate) {
          protectedApproved = policy.mode === 'touch_and_flag' || linkedOpportunity.review_status === 'approved';
          await repository.updateOpportunityObservation(linkedOpportunity.id, posting.fetchedAt);

          const changed = changedFlaggedFields(
            {
              title: draft.title,
              posting_url: draft.posting_url,
              location: draft.location,
              eligibility: draft.eligibility,
              focus_area: draft.focus_area,
              deadline: draft.deadline,
              deadline_text: draft.deadline_text,
              paid_status: draft.paid_status,
              application_type: draft.application_type,
              source_status_raw: draft.source_status_raw,
            },
            linkedOpportunity as unknown as Record<string, unknown>,
          );

          if (materialChanged || changed.length > 0) {
            await ensureOpenSourceReviewTask({
              repository,
              taskType: 'source_changed',
              entityTable: 'opportunities',
              entityId: linkedOpportunity.id,
              materialHash: sourcePosting.last_material_hash,
              noteTag: 'source_changed',
              noteBody: `Linked source posting changed; opportunity fields preserved. Changed fields: ${changed.join(', ') || 'material_hash_only'}.`,
            });
          }
        } else {
          const casResult = await repository.updateOpportunityDraftFromPosting(linkedOpportunity.id, {
            title: draft.title,
            postingUrl: draft.posting_url,
            location: draft.location,
            focusArea: draft.focus_area,
            deadline: draft.deadline,
            deadlineText: draft.deadline_text,
            applicationType: draft.application_type,
            sourceStatusRaw: draft.source_status_raw,
            eligibility: draft.eligibility,
            paidStatus: draft.paidStatus,
            audienceBucket: draft.audienceBucket,
            audienceReason: draft.audienceReason,
            scientificLanes: draft.scientificLanes,
            jobFunctions: draft.jobFunctions,
            methods: draft.methods,
            graduateStage: draft.graduateStage,
            eligibilityStatus: draft.eligibilityStatus,
            eligibilityEvidence: draft.eligibilityEvidence,
            continuedEnrollmentRequired: draft.continuedEnrollmentRequired,
            workAuthorization: draft.workAuthorization,
            applicationOpenedAt: draft.applicationOpenedAt,
            lastCheckedAt: draft.lastCheckedAt,
            sourceCheckResult: draft.sourceCheckResult,
            discoveryRoute: draft.discoveryRoute,
            relevanceScore: posting.relevanceScore,
            relevanceReasons: [`score:${posting.relevanceScore}`],
            observedAtIso: posting.fetchedAt,
          });

          if (!casResult.updated) {
            // The opportunity was concurrently approved, rejected, or moved to a
            // protected lifecycle state.  Preserve all fields; only touch
            // observation metadata and open a source_changed task.
            await repository.updateOpportunityObservation(linkedOpportunity.id, posting.fetchedAt);
            await ensureOpenSourceReviewTask({
              repository,
              taskType: 'source_changed',
              entityTable: 'opportunities',
              entityId: linkedOpportunity.id,
              materialHash: sourcePosting.last_material_hash,
              noteTag: 'source_changed',
              noteBody: `Linked source posting changed; opportunity protected during race. Material change detected.`,
            });
          }
        }

        matchType = 'exact';
        await ensureLink({
          repository,
          opportunityId: linkedOpportunity.id,
          sourcePostingId: sourcePosting.id,
          matchType,
          requestPrimary: true,
        });
      }
    }
  }

  if (!linkedOpportunity && posting.relevanceScore >= PENDING_OPPORTUNITY_MIN_SCORE) {
    const pending = await repository.insertPendingOpportunity({
      companyId: draft.companyId,
      sourceRecordId: jobSource.source_record_id,
      title: draft.title,
      postingUrl: draft.posting_url,
      location: draft.location,
      focusArea: draft.focus_area,
      deadline: draft.deadline,
      deadlineText: draft.deadline_text,
      paidStatus: draft.paid_status,
      applicationType: draft.application_type,
      sourceStatusRaw: draft.source_status_raw,
      relevanceScore: posting.relevanceScore,
      dedupeKey: draft.dedupe_key,
      familyKey: draft.family_key,
      observedAtIso: posting.fetchedAt,
    });

    linkedOpportunity = pending;
    createdPendingOpportunityId = pending.id;
    matchType = 'exact';
    await ensureLink({
      repository,
      opportunityId: pending.id,
      sourcePostingId: sourcePosting.id,
      matchType,
      requestPrimary: true,
    });

    // The concurrency-safe insert RPC intentionally has a narrow, stable
    // signature. Fill the evidence-backed review fields immediately afterward,
    // guarded by the same pending-only compare-and-set used for refreshes.
    await repository.updateOpportunityDraftFromPosting(pending.id, {
      title: draft.title,
      postingUrl: draft.posting_url,
      location: draft.location,
      focusArea: draft.focus_area,
      deadline: draft.deadline,
      deadlineText: draft.deadline_text,
      applicationType: draft.application_type,
      sourceStatusRaw: draft.source_status_raw,
      eligibility: draft.eligibility,
      paidStatus: draft.paidStatus,
      audienceBucket: draft.audienceBucket,
      audienceReason: draft.audienceReason,
      scientificLanes: draft.scientificLanes,
      jobFunctions: draft.jobFunctions,
      methods: draft.methods,
      graduateStage: draft.graduateStage,
      eligibilityStatus: draft.eligibilityStatus,
      eligibilityEvidence: draft.eligibilityEvidence,
      continuedEnrollmentRequired: draft.continuedEnrollmentRequired,
      workAuthorization: draft.workAuthorization,
      applicationOpenedAt: draft.applicationOpenedAt,
      lastCheckedAt: draft.lastCheckedAt,
      sourceCheckResult: draft.sourceCheckResult,
      discoveryRoute: draft.discoveryRoute,
      relevanceScore: posting.relevanceScore,
      relevanceReasons: [`score:${posting.relevanceScore}`],
      observedAtIso: posting.fetchedAt,
    });

    if (companyResolution.matchedFuzzy) {
      await ensureOpenSourceReviewTask({
        repository,
        taskType: 'possible_duplicate',
        entityTable: 'opportunities',
        entityId: pending.id,
        materialHash: sourcePosting.last_material_hash,
        noteTag: 'company_fuzzy',
        noteBody: 'Fuzzy company match requires officer review before company association is treated as exact.',
      });
    }
  }

  return {
    createdPendingOpportunityId,
    linkedOpportunityId: linkedOpportunity?.id ?? null,
    linkMatchType: matchType,
    protectedApprovedOpportunity: protectedApproved,
  };
}
