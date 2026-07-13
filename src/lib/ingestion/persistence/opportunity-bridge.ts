'use server';

import { makeFamilyKey, makeStrictKey } from '../../csvImport';
import {
  changedFlaggedFields,
  decideUpdatePolicy,
  matchOpportunity,
  type ExistingOpportunity,
} from '../../dedupe';
import type { PersistedLinkMatchType, NormalizedSourcePosting } from '../types';
import { ensureOpenSourceReviewTask } from './review-tasks';
import type {
  IngestionRepository,
  JobSourceRow,
  OpportunityRow,
  SourcePostingRow,
} from './repository';

export const PENDING_OPPORTUNITY_MIN_SCORE = 35;

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
    eligibility: null,
    focus_area: posting.focusArea,
    deadline: posting.closesAt,
    deadline_text: posting.closesAt,
    paid_status: 'unknown' as const,
    application_type: posting.employmentType,
    source_status_raw: 'open',
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
  const draft = postingToDraft(posting, jobSource.company_id);

  const existingOpportunities = await repository.listOpenOpportunities();
  const match = matchOpportunity(draft, existingOpportunities.map(toExistingOpportunity));

  let linkedOpportunity: OpportunityRow | null = null;
  let matchType: PersistedLinkMatchType | null = null;
  let protectedApproved = false;
  let createdPendingOpportunityId: string | null = null;

  if (match.kind === 'same_url' || match.kind === 'strict_key' || match.kind === 'family' || match.kind === 'fuzzy') {
    linkedOpportunity = await repository.findOpportunityById(match.opportunityId);
    if (linkedOpportunity) {
      const policy = decideUpdatePolicy(linkedOpportunity);
      if (policy.mode === 'touch_and_flag') {
        protectedApproved = true;
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
            noteBody: `Linked source posting changed; approved/public opportunity preserved. Changed fields: ${changed.join(', ') || 'material_hash_only'}.`,
          });
        }
      } else {
        await repository.updateOpportunityDraftFromPosting(linkedOpportunity.id, {
          title: draft.title,
          postingUrl: draft.posting_url,
          location: draft.location,
          focusArea: draft.focus_area,
          deadline: draft.deadline,
          deadlineText: draft.deadline_text,
          applicationType: draft.application_type,
          sourceStatusRaw: draft.source_status_raw,
          relevanceScore: posting.relevanceScore,
          relevanceReasons: [`score:${posting.relevanceScore}`],
          observedAtIso: posting.fetchedAt,
        });
      }

      matchType = mapMatchTypeToLinkType(match.kind);
      await repository.insertLink({
        opportunityId: linkedOpportunity.id,
        sourcePostingId: sourcePosting.id,
        matchType,
        isPrimary: matchType === 'exact',
      });
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
    matchType = 'alternate_source';
    await repository.insertLink({
      opportunityId: pending.id,
      sourcePostingId: sourcePosting.id,
      matchType,
      isPrimary: false,
    });
  }

  return {
    createdPendingOpportunityId,
    linkedOpportunityId: linkedOpportunity?.id ?? null,
    linkMatchType: matchType,
    protectedApprovedOpportunity: protectedApproved,
  };
}
