import { describe, expect, it } from 'vitest';

import { bridgeOpportunityForSourcePosting } from '../../lib/ingestion/persistence/opportunity-bridge';
import type {
  IngestionRepository,
  JobSourceRow,
  OpportunityRow,
  ReviewTaskRow,
  SourcePostingRow,
} from '../../lib/ingestion/persistence/repository';
import type { NormalizedSourcePosting } from '../../lib/ingestion/types';

function normalizedPosting(): NormalizedSourcePosting {
  return {
    identityKey: 'greenhouse:ginkgobioworks:5022683007',
    materialHash: 'a'.repeat(64),
    connectorVersion: 'test',
    sourceKind: 'greenhouse',
    externalPostingId: '5022683007',
    internalJobId: null,
    requisitionId: null,
    employerNameRaw: 'Ginkgo Bioworks',
    employerNameNormalized: 'ginkgo bioworks',
    titleRaw: 'Automation Scientist Intern, RAC Operations',
    titleNormalized: 'automation scientist intern rac operations',
    locationRaw: 'Boston, MA',
    locationNormalized: 'boston ma',
    canonicalUrl: 'https://job-boards.greenhouse.io/ginkgobioworks/jobs/5022683007',
    remoteType: 'onsite',
    employmentType: 'Internship',
    classification: 'internship',
    department: 'Research',
    departments: ['Research'],
    offices: ['Boston, MA'],
    focusArea: 'Laboratory automation and scientific software',
    postedAt: '2026-04-01',
    closesAt: null,
    deadlineKind: 'unknown',
    descriptionText: 'No college degree necessary; relevant coding, biology, or computational biology skills required.',
    language: 'en',
    sourceUpdatedAt: '2026-04-01T12:35:30.000Z',
    sourceMetadata: null,
    relevanceScore: 95,
    relevanceScoreVersion: 4,
    scoreBreakdown: {
      version: 4,
      total: 95,
      rawTotal: 95,
      positiveReasons: [],
      negativeReasons: [],
      uncertaintyFlags: [],
    },
    uncertaintyFlags: [],
    fetchedAt: '2026-09-13T23:30:00.000Z',
  };
}

describe('protected opportunity source-change reviews', () => {
  it('does not reopen source_changed review when source material is unchanged but derived fields differ', async () => {
    const posting = normalizedPosting();
    const opportunity: OpportunityRow = {
      id: 'opp-1',
      company_id: 'co-1',
      title: posting.titleRaw!,
      posting_url: posting.canonicalUrl,
      dedupe_key: 'existing-dedupe-key',
      family_key: 'existing-family-key',
      review_status: 'approved',
      public_safe: true,
      last_seen_at: '2026-09-13T17:00:00.000Z',
      location: posting.locationRaw,
      eligibility: null,
      focus_area: 'Bioinformatics and computational biology',
      deadline: null,
      deadline_text: 'Not stated or rolling',
      paid_status: 'unknown',
      application_type: null,
      source_status_raw: 'open',
      status: 'open_verified',
    };
    const jobSource: JobSourceRow = {
      id: 'source-1',
      source_record_id: 'source-record-1',
      company_id: 'co-1',
      source_name: 'Ginkgo Bioworks',
    };
    const sourcePosting: SourcePostingRow = {
      id: 'posting-1',
      job_source_id: 'source-1',
      identity_key: posting.identityKey,
      canonical_url: posting.canonicalUrl,
      current_status: 'open',
      first_seen_at: '2026-09-12T00:00:00.000Z',
      last_seen_at: posting.fetchedAt,
      last_material_hash: posting.materialHash,
      relevance_score: posting.relevanceScore,
      relevance_score_version: posting.relevanceScoreVersion,
    };
    const tasks: ReviewTaskRow[] = [];

    const repository = {
      resolveCompanyId: async () => ({ companyId: 'co-1', matchedFuzzy: false }),
      listMatchableOpportunities: async () => [opportunity],
      findOpportunityById: async () => opportunity,
      updateOpportunityObservation: async (_id: string, observedAtIso: string) => {
        opportunity.last_seen_at = observedAtIso;
      },
      findOpenReviewTask: async () => null,
      insertReviewTask: async (taskType: string, entityTable: string, entityId: string, notes: string) => {
        const task: ReviewTaskRow = {
          id: `task-${tasks.length + 1}`,
          task_type: taskType,
          entity_table: entityTable,
          entity_id: entityId,
          status: 'open',
          notes,
        };
        tasks.push(task);
        return task;
      },
      getLink: async () => ({
        id: 'link-1',
        opportunity_id: opportunity.id,
        source_posting_id: sourcePosting.id,
        match_type: 'exact' as const,
        is_primary: true,
      }),
      getLinkForSourcePosting: async () => ({
        id: 'link-1',
        opportunity_id: opportunity.id,
        source_posting_id: sourcePosting.id,
        match_type: 'exact' as const,
        is_primary: true,
      }),
    } as unknown as IngestionRepository;

    const result = await bridgeOpportunityForSourcePosting({
      repository,
      jobSource,
      sourcePosting,
      posting,
      materialChanged: false,
    });

    expect(result.protectedApprovedOpportunity).toBe(true);
    expect(opportunity.focus_area).toBe('Bioinformatics and computational biology');
    expect(opportunity.last_seen_at).toBe(posting.fetchedAt);
    expect(tasks).toHaveLength(0);
  });
});
