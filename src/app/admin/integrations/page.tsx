import Link from 'next/link';
import { googleSheetsConfigured } from '@/lib/google-sheets';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function StatusCard({
  title, state, detail, footnote,
}: { title: string; state: 'Ready' | 'Waiting' | 'Attention'; detail: string; footnote?: string }) {
  const color = state === 'Ready' ? '#166534' : state === 'Attention' ? '#991b1b' : '#92400e';
  return <article className="rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
    <div className="flex items-start justify-between gap-3">
      <h2 className="font-semibold">{title}</h2>
      <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ color, background: `${color}12` }}>{state}</span>
    </div>
    <p className="mt-3 text-sm">{detail}</p>
    {footnote ? <p className="mt-2 text-xs" style={{ color: 'var(--ink-soft)' }}>{footnote}</p> : null}
  </article>;
}

export default async function IntegrationsPage() {
  await requireOfficer();
  const db = createServiceClient();
  const sheetReady = googleSheetsConfigured();
  const sheetSourceId = process.env.GOOGLE_SHEETS_SOURCE_RECORD_ID?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const cronReady = Boolean(cronSecret && cronSecret.length >= 32);
  const [
    latestImport,
    latestFetch,
    latestExtraction,
    publicCount,
    reviewCount,
    leadCount,
    sourceCount,
    enabledSourceCount,
    officerCount,
    sheetSource,
  ] = await Promise.all([
    db.from('import_runs').select('id, filename, status, started_at, finished_at, total_rows, inserted_count, updated_count, error_count')
      .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('source_fetch_runs').select('id, status, scheduled_for, started_at, finished_at, records_seen, records_new, records_changed, error_class')
      .order('scheduled_for', { ascending: false }).limit(1).maybeSingle(),
    db.from('pipeline_extractions').select('id, created_at, evidence_ok, model')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('public_opportunities').select('*', { count: 'exact', head: true }),
    db.from('review_tasks').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
    db.from('discovery_leads').select('*', { count: 'exact', head: true }).eq('officer_status', 'new'),
    db.from('job_sources').select('*', { count: 'exact', head: true }),
    db.from('job_sources').select('*', { count: 'exact', head: true }).eq('enabled', true),
    db.from('officers').select('*', { count: 'exact', head: true }).eq('is_active', true),
    sheetReady && sheetSourceId
      ? db.from('source_records').select('id, name, last_imported_at').eq('id', sheetSourceId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const importRow = latestImport.data;
  const fetchRow = latestFetch.data;
  const extractionRow = latestExtraction.data;
  const sourceQueriesFailed = Boolean(sourceCount.error || enabledSourceCount.error);
  const configuredSources = sourceCount.count ?? 0;
  const enabledSources = enabledSourceCount.count ?? 0;

  return <div className="space-y-7">
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Integration status</h1>
      <p className="mt-2 max-w-3xl text-sm" style={{ color: 'var(--ink-soft)' }}>
        This page reports the last durable handoff at each boundary. A green public count does not mean
        unreviewed data was published. Publication still requires an officer decision.
      </p>
    </div>

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <StatusCard
        title="Google Sheet → private intake"
        state={!sheetReady ? 'Waiting' : sheetSource.error || !sheetSource.data || latestImport.error || importRow?.status === 'failed' ? 'Attention' : importRow?.status === 'completed' ? 'Ready' : 'Waiting'}
        detail={!sheetReady ? 'Read-only Sheet credentials are not configured.' : sheetSource.error || !sheetSource.data ? 'The configured Sheet source record is unavailable.' : `Last import: ${when(importRow?.finished_at ?? importRow?.started_at ?? sheetSource.data.last_imported_at)}`}
        footnote={importRow ? `${importRow.filename} · ${importRow.status} · ${importRow.total_rows} rows · ${importRow.error_count} errors` : sheetSource.data ? `${sheetSource.data.name} is connected, but no import run has been recorded.` : 'No import run has been recorded.'}
      />
      <StatusCard
        title="Scheduled orchestration"
        state={cronReady ? 'Ready' : 'Attention'}
        detail={cronReady ? 'Daily ingestion and weekly health endpoints have a valid authorization secret.' : 'CRON_SECRET is missing or shorter than 32 characters.'}
        footnote="The secret value is never displayed. Schedules are declared in vercel.json and endpoints fail closed when authorization is absent."
      />
      <StatusCard
        title="Machine source controls"
        state={sourceQueriesFailed ? 'Attention' : configuredSources > 0 && enabledSources > 0 ? 'Ready' : 'Waiting'}
        detail={sourceQueriesFailed ? 'Source registry counts are unavailable.' : `${configuredSources} configured source${configuredSources === 1 ? '' : 's'}; ${enabledSources} enabled.`}
        footnote={configuredSources === 0 ? 'No production machine source exists. Use a reviewed private test before enabling one.' : enabledSources === 0 ? 'Scheduling is intentionally idle until an officer enables a reviewed source.' : 'Only sources with completed terms and robots review can be enabled.'}
      />
      <StatusCard
        title="Officer continuity"
        state={officerCount.error || (officerCount.count ?? 0) < 2 ? 'Attention' : 'Ready'}
        detail={officerCount.error ? 'Active officer count is unavailable.' : `${officerCount.count ?? 0} active officer account${officerCount.count === 1 ? '' : 's'}.`}
        footnote={(officerCount.count ?? 0) < 2 ? 'Add and test a second named officer before relying on this system during officer turnover.' : 'At least two named officers can maintain the review workflow.'}
      />
      <StatusCard
        title="Approved sources → raw archive"
        state={latestFetch.error || ['failed', 'partial'].includes(fetchRow?.status ?? '') ? 'Attention' : fetchRow?.status === 'completed' ? 'Ready' : 'Waiting'}
        detail={latestFetch.error ? `Unavailable: ${latestFetch.error.message}` : `Last source run: ${when(fetchRow?.finished_at ?? fetchRow?.started_at ?? fetchRow?.scheduled_for)}`}
        footnote={fetchRow ? `${fetchRow.status} · ${fetchRow.records_seen} seen · ${fetchRow.records_new} new · ${fetchRow.records_changed} changed${fetchRow.error_class ? ` · ${fetchRow.error_class}` : ''}` : 'No source run has been recorded.'}
      />
      <StatusCard
        title="Archived versions → extraction"
        state={latestExtraction.error || (extractionRow && !extractionRow.evidence_ok) ? 'Attention' : extractionRow ? 'Ready' : 'Waiting'}
        detail={latestExtraction.error ? `Unavailable: ${latestExtraction.error.message}` : `Last extraction: ${when(extractionRow?.created_at)}`}
        footnote={extractionRow ? `${extractionRow.model} · evidence ${extractionRow.evidence_ok ? 'bound' : 'failed'}` : 'The model is disabled by default; no extraction is required for manual review.'}
      />
      <StatusCard
        title="Discovery → officer tasks"
        state={leadCount.error || reviewCount.error ? 'Attention' : 'Ready'}
        detail={leadCount.error ? `Lead archive unavailable: ${leadCount.error.message}` : `${leadCount.count ?? 0} new discovery leads retained.`}
        footnote={reviewCount.error ? reviewCount.error.message : `${reviewCount.count ?? 0} open or in-progress review tasks.`}
      />
      <StatusCard
        title="Officer approval → public view"
        state={publicCount.error ? 'Attention' : 'Ready'}
        detail={publicCount.error ? `Public view unavailable: ${publicCount.error.message}` : `${publicCount.count ?? 0} approved opportunities are currently public.`}
        footnote="The website reads public_opportunities directly. No export, Git commit, or redeploy is needed after approval."
      />
      <article className="rounded-xl p-5" style={{ border: '1px solid var(--line)', background: 'var(--brand-soft)' }}>
        <h2 className="font-semibold">Operator actions</h2>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link className="primary-button" href="/admin/import">Sync intake</Link>
          <Link className="secondary-button" href="/admin/sources">Manage sources</Link>
          <Link className="secondary-button" href="/admin/review">Review queue</Link>
          <a className="secondary-button" href="/api/export?format=csv">Export approved</a>
        </div>
      </article>
    </div>
  </div>;
}
