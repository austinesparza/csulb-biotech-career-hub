// Officer review queue. Server component loads pending records with the
// service client (after requireOfficer); the client list handles the
// guardrailed approve flow.
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { ReviewList, type ReviewRow } from './review-list';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  await requireOfficer();
  const db = createServiceClient();

  const { data } = await db
    .from('opportunities')
    .select(
      'id, title, posting_url, location, eligibility, focus_area, deadline, deadline_text, ' +
      'start_date_text, paid_status, application_type, source_status_raw, public_notes, ' +
      'private_notes, relevance_score, relevance_reasons, audience_bucket, audience_reason, ' +
      'graduate_stage, scientific_lanes, job_functions, methods, ' +
      'companies(name, public_safe)',
    )
    .eq('status', 'needs_review')
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .limit(100);

  const opportunities = (data ?? []) as unknown as Omit<ReviewRow, 'extraction'>[];
  const ids = opportunities.map((row) => row.id);
  const latestByOpportunity = new Map<string, NonNullable<ReviewRow['extraction']>>();

  if (ids.length > 0) {
    // Evidence is additive. Records created before the extraction pipeline still
    // appear in the same queue with no evidence panel.
    const { data: extractions } = await db
      .from('pipeline_extractions')
      .select(
        'id, opportunity_id, created_at, evidence_ok, binding_failures, injection_flags, classification, ' +
        'fields, bindings, source_posting_versions(normalized_json)',
      )
      .in('opportunity_id', ids)
      .order('created_at', { ascending: false });

    for (const item of (extractions ?? []) as unknown as Array<Record<string, unknown>>) {
      const opportunityId = item.opportunity_id as string | null;
      if (!opportunityId || latestByOpportunity.has(opportunityId)) continue;
      const relation = item.source_posting_versions;
      const version = (Array.isArray(relation) ? relation[0] : relation) as
        | { normalized_json?: Record<string, unknown> }
        | null;
      const rawText = typeof version?.normalized_json?.descriptionText === 'string'
        ? version.normalized_json.descriptionText
        : null;
      latestByOpportunity.set(opportunityId, {
        id: item.id as string,
        created_at: item.created_at as string,
        evidence_ok: Boolean(item.evidence_ok),
        binding_failures: (item.binding_failures as string[]) ?? [],
        injection_flags: (item.injection_flags as string[]) ?? [],
        classification: (item.classification as NonNullable<ReviewRow['extraction']>['classification']) ?? {},
        fields: (item.fields as NonNullable<ReviewRow['extraction']>['fields']) ?? {},
        bindings: (item.bindings as NonNullable<ReviewRow['extraction']>['bindings']) ?? {},
        raw_text: rawText,
      });
    }
  }

  const rows: ReviewRow[] = opportunities.map((row) => ({
    ...row,
    extraction: latestByOpportunity.get(row.id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          {rows.length} pending · sorted by relevance
        </span>
      </div>
      <p className="max-w-2xl text-sm" style={{ color: 'var(--ink-soft)' }}>
        Nothing goes public until you approve it here. Open the posting link first,
        then confirm the public notes contain no private information.
      </p>
      <ReviewList rows={rows} />
    </div>
  );
}
