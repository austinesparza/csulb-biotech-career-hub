// Officer review queue. Server component loads pending records with the
// service client (after requireOfficer); the client list handles the
// guardrailed approve flow.
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import type { DiscoveryLead, DiscoveryLeadObservationRow, ReviewTask, UserSubmission } from '@/lib/types';
import { readSheetReviewIntent } from '@/lib/sheet-review';
import { ReviewList, type ReviewRow } from './review-list';
import { SubmissionList } from './submission-list';
import { TaskList } from './task-list';
import { DiscoveryLeadList, type DiscoveryLeadRow } from './discovery-lead-list';

export const dynamic = 'force-dynamic';

type ReviewTab = 'opportunities' | 'leads' | 'submissions' | 'tasks';

function TabNav({ selected }: { selected: ReviewTab }) {
  const tabs: Array<[ReviewTab, string]> = [
    ['opportunities', 'Opportunities'], ['leads', 'Discovery leads'], ['submissions', 'Submissions'], ['tasks', 'Tasks'],
  ];
  return <nav className="admin-tabs" aria-label="Review queues">{tabs.map(([key, label]) => (
    <a
      key={key}
      className={selected === key ? 'admin-tab-link is-active' : 'admin-tab-link'}
      href={key === 'opportunities' ? '/admin/review' : `/admin/review?tab=${key}`}
      aria-current={selected === key ? 'page' : undefined}
    >
      {label}
    </a>
  ))}</nav>;
}

function ReviewHeader({ title, deck, badge }: { title: string; deck: string; badge?: string }) {
  return <header className="admin-page-head">
    <div className="admin-page-head-copy">
      <div className="admin-page-eyebrow">Officer review</div>
      <h1 className="admin-page-title">{title}</h1>
      <p className="admin-page-deck">{deck}</p>
    </div>
    {badge ? <span className="admin-status-badge admin-status-watch">{badge}</span> : null}
  </header>;
}

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireOfficer();
  const db = createServiceClient();
  const requested = (await searchParams).tab;
  const selected: ReviewTab = requested === 'leads' || requested === 'submissions' || requested === 'tasks' ? requested : 'opportunities';

  if (selected === 'leads') {
    const { data, error } = await db.from('discovery_leads')
      .select('id, route, original_url, normalized_url, canonical_employer_url, resolution, archive_reason, lane, latest_title, latest_snippet, employer_hint, original_reachable, officer_status, first_seen_at, last_seen_at, occurrence_count')
      .in('officer_status', ['new', 'in_review'])
      .order('last_seen_at', { ascending: false })
      .limit(100);
    const leads = (data ?? []) as DiscoveryLead[];
    const ids = leads.map((lead) => lead.id);
    const latestObservationByLead = new Map<string, DiscoveryLeadObservationRow>();
    if (ids.length > 0) {
      const observationResult = await db.from('discovery_lead_observations')
        .select('lead_id, run_id, query, retrieved_at, raw_metadata')
        .in('lead_id', ids)
        .order('retrieved_at', { ascending: false })
        .limit(500);
      if (observationResult.error) {
        return <div className="admin-page-flow">
          <ReviewHeader
            title="Discovery leads"
            deck="Search results stay private until an officer resolves provenance and follows an employer-controlled source."
          />
          <TabNav selected={selected} />
          <p role="alert">Could not load discovery evidence: {observationResult.error.message}</p>
        </div>;
      }
      for (const observation of (observationResult.data ?? []) as DiscoveryLeadObservationRow[]) {
        if (!latestObservationByLead.has(observation.lead_id)) {
          latestObservationByLead.set(observation.lead_id, observation);
        }
      }
    }
    const rows: DiscoveryLeadRow[] = leads.map((lead) => ({
      ...lead,
      latest_observation: latestObservationByLead.get(lead.id) ?? null,
    }));
    return <div className="admin-page-flow">
      <ReviewHeader
        title="Discovery leads"
        deck="Review provenance and follow employer-controlled sources before creating any opportunity draft. Nothing on this tab can publish to the public board."
        badge={`${rows.length} active leads`}
      />
      <TabNav selected={selected} />
      {error ? <p role="alert">Could not load discovery leads: {error.message}</p> : <DiscoveryLeadList rows={rows} />}
    </div>;
  }

  if (selected === 'submissions') {
    const { data, error } = await db.from('user_submissions').select('*')
      .in('status', ['new', 'in_review']).order('created_at', { ascending: true }).limit(100);
    const rows = (data ?? []) as UserSubmission[];
    const researchCount = rows.filter((row) => row.payload?.intake_stage === 'source_research').length;
    return <div className="admin-page-flow">
      <ReviewHeader
        title="Submissions and source research"
        deck="Student suggestions and screenshot leads stay private. Source-research leads need an individual employer posting before a review draft can be created."
        badge={`${rows.length - researchCount} submissions · ${researchCount} source leads`}
      />
      <TabNav selected={selected} />
      {error ? <p role="alert">Could not load submissions: {error.message}</p> : <SubmissionList rows={rows} />}
    </div>;
  }

  if (selected === 'tasks') {
    const { data, error } = await db.from('review_tasks').select('*')
      .in('status', ['open', 'in_progress']).order('priority', { ascending: true }).order('created_at', { ascending: true }).limit(100);
    const rows = (data ?? []) as ReviewTask[];
    return <div className="admin-page-flow">
      <ReviewHeader
        title="Review tasks"
        deck="Tasks flag changes, possible duplicates, broken links, and source-health problems that need an officer decision."
        badge={`${rows.length} active tasks`}
      />
      <TabNav selected={selected} />
      {error ? <p role="alert">Could not load tasks: {error.message}</p> : <TaskList rows={rows} />}
    </div>;
  }

  const { data, error } = await db
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

  const opportunities = (data ?? []) as unknown as Omit<ReviewRow, 'extraction' | 'sheet_review'>[];
  const ids = opportunities.map((row) => row.id);
  const latestByOpportunity = new Map<string, NonNullable<ReviewRow['extraction']>>();
  const sheetReviewByOpportunity = new Map<string, NonNullable<ReviewRow['sheet_review']>>();

  if (ids.length > 0) {
    const [rawResult, extractionResult] = await Promise.all([
      db.from('raw_import_rows')
        .select('matched_opportunity_id, raw, created_at')
        .in('matched_opportunity_id', ids)
        .order('created_at', { ascending: false }),
      db.from('pipeline_extractions')
        .select(
          'id, opportunity_id, created_at, evidence_ok, binding_failures, injection_flags, classification, ' +
          'fields, bindings, source_posting_versions(normalized_json)',
        )
        .in('opportunity_id', ids)
        .order('created_at', { ascending: false }),
    ]);

    const rawRows = rawResult.data;
    for (const item of (rawRows ?? []) as Array<{ matched_opportunity_id: string | null; raw: Record<string, unknown> }>) {
      if (!item.matched_opportunity_id || sheetReviewByOpportunity.has(item.matched_opportunity_id)) continue;
      sheetReviewByOpportunity.set(item.matched_opportunity_id, readSheetReviewIntent(item.raw));
    }

    // Evidence is additive. Records created before the extraction pipeline still
    // appear in the same queue with no evidence panel.
    const extractions = extractionResult.data;

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
    sheet_review: sheetReviewByOpportunity.get(row.id) ?? null,
  }));

  return (
    <div className="admin-page-flow">
      <ReviewHeader
        title="Opportunity review"
        deck="Open the official posting first, verify the evidence, and confirm that public notes contain no private information before approval."
        badge={`${rows.length} pending`}
      />
      <TabNav selected={selected} />
      {error ? <p role="alert">Could not load opportunities: {error.message}</p> : <ReviewList rows={rows} />}
    </div>
  );
}
