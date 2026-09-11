import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import type { OpportunityCorrectionDraft } from '@/lib/opportunity-corrections';
import type { AudienceBucket, GraduateStage, PaidStatus } from '@/lib/types';
import { OpportunityManager, type ManagedOpportunity, type RevisionSummary } from './opportunity-manager';

export const dynamic = 'force-dynamic';

const SUMMARY_FIELDS = [
  'title', 'posting_url', 'location', 'eligibility', 'focus_area', 'deadline',
  'deadline_text', 'start_date_text', 'paid_status', 'application_type', 'status',
  'public_notes', 'audience_bucket', 'audience_reason', 'graduate_stage',
  'eligibility_evidence', 'work_authorization', 'public_safe',
];

interface OpportunityQueryRow {
  id: string;
  updated_at: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  start_date_text: string | null;
  paid_status: string;
  application_type: string | null;
  status: string;
  public_notes: string | null;
  audience_bucket: string;
  audience_reason: string | null;
  graduate_stage: string;
  eligibility_evidence: string | null;
  work_authorization: string | null;
  public_safe: boolean;
  companies: unknown;
}

function relationName(value: unknown): string {
  const relation = value as { name?: string } | Array<{ name?: string }> | null;
  return (Array.isArray(relation) ? relation[0]?.name : relation?.name) ?? 'Unknown company';
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return SUMMARY_FIELDS.filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null));
}

export default async function ManageOpportunitiesPage() {
  await requireOfficer();
  const db = createServiceClient();
  const { data, error } = await db.from('opportunities').select(
    'id, updated_at, title, posting_url, location, eligibility, focus_area, deadline, deadline_text, ' +
    'start_date_text, paid_status, application_type, status, public_notes, audience_bucket, audience_reason, ' +
    'graduate_stage, eligibility_evidence, work_authorization, public_safe, companies(name)',
  ).eq('review_status', 'approved')
    .in('status', ['open_verified', 'open_unverified', 'hidden'])
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) return <p role="alert">Could not load approved opportunities: {error.message}</p>;
  const opportunityRows = (data ?? []) as unknown as OpportunityQueryRow[];
  const opportunityIds = opportunityRows.map((row) => row.id);
  const revisionsByOpportunity = new Map<string, RevisionSummary[]>();

  if (opportunityIds.length > 0) {
    const { data: revisions } = await db.from('opportunity_revisions')
      .select('id, opportunity_id, revision_number, action, reason, changed_by, before_snapshot, after_snapshot, created_at')
      .in('opportunity_id', opportunityIds)
      .order('revision_number', { ascending: false });
    const userIds = [...new Set((revisions ?? []).map((revision) => revision.changed_by))];
    const { data: officers } = userIds.length > 0
      ? await db.from('officers').select('user_id, display_name').in('user_id', userIds)
      : { data: [] };
    const names = new Map((officers ?? []).map((officer) => [officer.user_id, officer.display_name]));

    for (const revision of revisions ?? []) {
      const list = revisionsByOpportunity.get(revision.opportunity_id) ?? [];
      list.push({
        id: revision.id,
        revisionNumber: revision.revision_number,
        action: revision.action as RevisionSummary['action'],
        reason: revision.reason,
        changedBy: names.get(revision.changed_by) ?? 'Officer',
        createdAt: revision.created_at,
        changes: changedFields(
          revision.before_snapshot as Record<string, unknown>,
          revision.after_snapshot as Record<string, unknown>,
        ),
      });
      revisionsByOpportunity.set(revision.opportunity_id, list);
    }
  }

  const rows: ManagedOpportunity[] = opportunityRows.map((row) => ({
    id: row.id,
    companyName: relationName(row.companies),
    updatedAt: row.updated_at,
    live: row.public_safe && ['open_verified', 'open_unverified'].includes(row.status),
    draft: {
      title: row.title,
      postingUrl: row.posting_url ?? '',
      location: row.location ?? '',
      eligibility: row.eligibility ?? '',
      focusArea: row.focus_area ?? '',
      deadline: row.deadline ?? '',
      deadlineText: row.deadline_text ?? '',
      startDateText: row.start_date_text ?? '',
      paidStatus: row.paid_status as PaidStatus,
      applicationType: row.application_type ?? '',
      status: row.status === 'open_unverified' ? 'open_unverified' : 'open_verified',
      publicNotes: row.public_notes ?? '',
      audienceBucket: row.audience_bucket as AudienceBucket,
      audienceReason: row.audience_reason ?? '',
      graduateStage: row.graduate_stage as GraduateStage,
      eligibilityEvidence: row.eligibility_evidence ?? '',
      workAuthorization: row.work_authorization ?? '',
    } satisfies OpportunityCorrectionDraft,
    revisions: revisionsByOpportunity.get(row.id) ?? [],
  }));

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Correct published records</h1>
      <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--ink-soft)' }}>
        Fix a public field, remove a record immediately, or restore an earlier version. Every action requires a reason and keeps a permanent officer audit trail.
      </p>
    </div>
    <OpportunityManager rows={rows} />
  </div>;
}
