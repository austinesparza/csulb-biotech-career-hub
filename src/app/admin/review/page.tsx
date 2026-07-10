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
      'private_notes, relevance_score, relevance_reasons, companies(name, public_safe)',
    )
    .eq('status', 'needs_review')
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .limit(100);

  const rows = (data ?? []) as unknown as ReviewRow[];

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
