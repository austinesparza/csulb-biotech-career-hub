// Admin dashboard home: review workload plus production operations health.
import Link from 'next/link';
import { loadDatabaseReleaseHealth } from '@/lib/database-release-health';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type HealthTone = 'good' | 'watch' | 'bad' | 'neutral';

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Never';
}

function ageHours(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (nowMs - timestamp) / 3_600_000);
}

function errorCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function sheetStatus(value: unknown): string {
  if (!value || typeof value !== 'object') return 'unknown';
  const status = (value as Record<string, unknown>).status;
  return typeof status === 'string' ? status : 'unknown';
}

function healthStyle(tone: HealthTone) {
  if (tone === 'good') return { background: '#16653412', color: '#166534' };
  if (tone === 'watch') return { background: '#b4530916', color: '#92400e' };
  if (tone === 'bad') return { background: '#991b1b12', color: '#991b1b' };
  return { background: '#07567212', color: '#075672' };
}

function statusClass(tone: HealthTone) {
  if (tone === 'good') return 'admin-status-badge admin-status-good';
  if (tone === 'bad') return 'admin-status-badge admin-status-bad';
  return 'admin-status-badge admin-status-watch';
}

export default async function AdminHome() {
  await requireOfficer();
  const db = createServiceClient();
  // The dashboard is force-dynamic, so this is one request timestamp, not render state.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const in14 = new Date(nowMs + 14 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date(nowMs).toISOString().slice(0, 10);

  const [
    needsReview,
    expiring,
    openTasks,
    newSubmissions,
    cyclesResult,
    sourceHealthResult,
    activeRunsResult,
    databaseRelease,
  ] = await Promise.all([
    db.from('opportunities').select('*', { count: 'exact', head: true }).eq('status', 'needs_review'),
    db.from('opportunities').select('*', { count: 'exact', head: true })
      .in('status', ['open_verified', 'open_unverified'])
      .gte('deadline', today).lte('deadline', in14),
    db.from('review_tasks').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('user_submissions').select('*', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('pipeline_cycles')
      .select('id, trigger_kind, status, started_at, finished_at, scheduled_count, recovered_count, claimed_count, completed_count, partial_count, failed_count, records_seen, review_tasks_created, sheet_sync_json, errors_json')
      .order('started_at', { ascending: false })
      .limit(6),
    db.from('job_sources')
      .select('id, source_name, enabled, automatic_scheduling_paused_at, consecutive_failures, degraded_at, last_attempted_at, last_successful_at')
      .order('source_name'),
    db.from('source_fetch_runs')
      .select('id, job_source_id, status, scheduled_for, started_at, created_at')
      .in('status', ['pending', 'running'])
      .order('created_at', { ascending: true })
      .limit(100),
    loadDatabaseReleaseHealth(db),
  ]);

  const cards = [
    { href: '/admin/review', label: 'Needing review', count: needsReview.count ?? 0 },
    { href: '/admin/review', label: 'Expiring in 14 days', count: expiring.count ?? 0 },
    { href: '/admin/review?tab=tasks', label: 'Open review tasks', count: openTasks.count ?? 0 },
    { href: '/admin/review?tab=submissions', label: 'New submissions', count: newSubmissions.count ?? 0 },
  ];

  const recentCycles = cyclesResult.data ?? [];
  const lastCycle = recentCycles[0] ?? null;
  const enabledSources = (sourceHealthResult.data ?? []).filter((source) => source.enabled && !source.automatic_scheduling_paused_at);
  const degradedSources = enabledSources.filter((source) => Boolean(source.degraded_at) || (source.consecutive_failures ?? 0) >= 3);
  const activeRuns = activeRunsResult.data ?? [];
  const pendingRuns = activeRuns.filter((run) => run.status === 'pending');
  const runningRuns = activeRuns.filter((run) => run.status === 'running');
  const oldestPendingHours = pendingRuns.reduce<number | null>((oldest, run) => {
    const age = ageHours(run.scheduled_for ?? run.created_at, nowMs);
    return age === null ? oldest : oldest === null ? age : Math.max(oldest, age);
  }, null);
  const oldestRunningHours = runningRuns.reduce<number | null>((oldest, run) => {
    const age = ageHours(run.started_at ?? run.created_at, nowMs);
    return age === null ? oldest : oldest === null ? age : Math.max(oldest, age);
  }, null);
  const staleQueue = (oldestPendingHours ?? 0) >= 2 || (oldestRunningHours ?? 0) >= 0.5;

  const schemaTone: HealthTone = databaseRelease.status === 'current' ? 'good' : databaseRelease.status === 'drift' ? 'bad' : 'watch';
  const pipelineTone: HealthTone = cyclesResult.error
    ? 'watch'
    : lastCycle?.status === 'completed'
      ? 'good'
      : lastCycle?.status === 'failed'
        ? 'bad'
        : lastCycle?.status === 'partial'
          ? 'watch'
          : 'neutral';
  const queueTone: HealthTone = activeRunsResult.error ? 'watch' : staleQueue ? 'bad' : activeRuns.length > 0 ? 'neutral' : 'good';
  const sourceTone: HealthTone = sourceHealthResult.error ? 'watch' : degradedSources.length > 0 ? 'bad' : 'good';
  const operationsNeedAttention = schemaTone !== 'good' || pipelineTone === 'bad' || pipelineTone === 'watch' || queueTone === 'bad' || sourceTone === 'bad';

  const healthCards = [
    {
      label: 'Database schema',
      value: databaseRelease.status === 'current' ? 'Current' : databaseRelease.status === 'drift' ? 'Migration pending' : 'Check unavailable',
      detail: databaseRelease.status === 'current'
        ? `${databaseRelease.appliedMigrationCount} migrations recorded`
        : `Expected ${databaseRelease.expectedMigration}`,
      tone: schemaTone,
    },
    {
      label: 'Last pipeline cycle',
      value: cyclesResult.error ? 'Unavailable' : lastCycle?.status ?? 'No cycles yet',
      detail: lastCycle ? `${when(lastCycle.started_at)} · ${lastCycle.records_seen ?? 0} records seen` : 'Run the pipeline once to establish a baseline.',
      tone: pipelineTone,
    },
    {
      label: 'Worker queue',
      value: `${pendingRuns.length} pending · ${runningRuns.length} running`,
      detail: staleQueue
        ? `Oldest wait ${Math.max(oldestPendingHours ?? 0, oldestRunningHours ?? 0).toFixed(1)}h`
        : 'No stale worker lease detected',
      tone: queueTone,
    },
    {
      label: 'Automated sources',
      value: `${degradedSources.length} degraded`,
      detail: `${enabledSources.length} enabled and unpaused`,
      tone: sourceTone,
    },
  ] as const;

  const quickActions = [
    { href: '/admin/review', title: 'Open review queue', note: 'Approve, reject, and resolve evidence' },
    { href: '/admin/sources', title: 'Run pipeline', note: 'Ingestion, recovery, reconciliation, Sheet sync' },
    { href: '/admin/import', title: 'Sync spreadsheet', note: 'Bring officer workspace rows into the archive' },
    { href: '/admin/add', title: 'Add a posting', note: 'Create a private draft from an official source' },
    { href: '/admin/manage', title: 'Published records', note: 'Correct or archive approved opportunities' },
    { href: '/admin/duplicates', title: 'Duplicate scan', note: 'Review likely record collisions' },
    { href: '/admin/integrations', title: 'Integration status', note: 'Inspect external service configuration' },
    { href: '/api/export?format=csv', title: 'Export approved', note: 'Download the current public dataset as CSV' },
  ];

  return (
    <div className="admin-page-flow">
      <header className="admin-page-head">
        <div className="admin-page-head-copy">
          <div className="admin-page-eyebrow">Operations</div>
          <h1 className="admin-page-title">Officer dashboard</h1>
          <p className="admin-page-deck">A private control room for review workload, publication safety, and the health of the Career Hub pipeline.</p>
        </div>
        <span className={statusClass(operationsNeedAttention ? 'watch' : 'good')}>
          {operationsNeedAttention ? 'Operations need attention' : 'Operations healthy'}
        </span>
      </header>

      <section aria-label="Review workload" className="admin-metric-grid">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="admin-metric-card">
            <div className="admin-metric-value">{card.count}</div>
            <div className="admin-metric-label">{card.label}</div>
            <span className="admin-metric-arrow" aria-hidden="true">↗</span>
          </Link>
        ))}
      </section>

      <section className={operationsNeedAttention ? 'admin-health-panel is-attention' : 'admin-health-panel'}>
        <div className="admin-panel-head">
          <div>
            <div className="admin-page-eyebrow">System state</div>
            <h2>Production health</h2>
            <p>Review workload is separate from infrastructure health. These checks show whether the database, pipeline, worker queue, and automated sources are actually operating.</p>
          </div>
          <Link href="/admin/sources" className="secondary-button">Open pipeline controls</Link>
        </div>
        <div className="admin-health-grid">
          {healthCards.map((card) => (
            <article key={card.label} className="admin-health-card">
              <div className="admin-health-label">{card.label}</div>
              <div className="admin-health-value">{card.value}</div>
              <p className="admin-health-detail">{card.detail}</p>
              <span className="mt-3 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold" style={healthStyle(card.tone)}>
                {card.tone === 'good' ? 'Healthy' : card.tone === 'bad' ? 'Action needed' : card.tone === 'watch' ? 'Review' : 'Active'}
              </span>
            </article>
          ))}
        </div>
        {degradedSources.length > 0 ? (
          <p className="admin-health-footnote" style={{ color: 'var(--restricted)' }}>
            Degraded sources: {degradedSources.map((source) => source.source_name).join(', ')}. Open Sources to inspect or pause them.
          </p>
        ) : null}
        {databaseRelease.status !== 'current' ? (
          <p className="admin-health-footnote" style={{ color: 'var(--restricted)' }}>
            Application code expects database migration <code>{databaseRelease.expectedMigration}</code>. This warning never applies migrations automatically.
          </p>
        ) : null}
      </section>

      <section className="admin-health-panel">
        <div className="admin-panel-head">
          <div>
            <div className="admin-page-eyebrow">Telemetry</div>
            <h2>Recent pipeline cycles</h2>
            <p>Newest first. Partial and failed cycles remain visible rather than being reported as successful.</p>
          </div>
        </div>
        {cyclesResult.error ? (
          <p className="p-5 text-sm" style={{ color: 'var(--restricted)' }}>Pipeline telemetry could not be loaded.</p>
        ) : recentCycles.length === 0 ? (
          <p className="p-5 text-sm" style={{ color: 'var(--ink-soft)' }}>No pipeline cycles have been recorded yet. Run the pipeline from Sources to establish the first production baseline.</p>
        ) : (
          <div className="admin-cycle-table-wrap">
            <table className="admin-cycle-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th>Sources</th>
                  <th>Records</th>
                  <th>Review tasks</th>
                  <th>Sheet</th>
                </tr>
              </thead>
              <tbody>
                {recentCycles.map((cycle) => {
                  const tone: HealthTone = cycle.status === 'completed' ? 'good' : cycle.status === 'failed' ? 'bad' : 'watch';
                  return (
                    <tr key={cycle.id}>
                      <td className="whitespace-nowrap">{when(cycle.started_at)}</td>
                      <td>{cycle.trigger_kind}</td>
                      <td>
                        <span className="rounded-full px-2 py-1 text-xs font-semibold" style={healthStyle(tone)}>{cycle.status}</span>
                        {errorCount(cycle.errors_json) > 0 ? <span className="ml-2 text-xs" style={{ color: 'var(--restricted)' }}>{errorCount(cycle.errors_json)} errors</span> : null}
                      </td>
                      <td>{cycle.completed_count ?? 0} ok · {cycle.partial_count ?? 0} partial · {cycle.failed_count ?? 0} failed</td>
                      <td>{cycle.records_seen ?? 0}</td>
                      <td>{cycle.review_tasks_created ?? 0}</td>
                      <td>{sheetStatus(cycle.sheet_sync_json)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="admin-page-head" style={{ paddingTop: 0 }}>
          <div className="admin-page-head-copy">
            <div className="admin-page-eyebrow">Workspace</div>
            <h2 className="text-2xl">Common actions</h2>
            <p className="admin-page-deck">The everyday officer tools, ordered around review and source stewardship rather than implementation details.</p>
          </div>
        </div>
        <nav className="admin-action-grid mt-4" aria-label="Officer actions">
          {quickActions.map((action) => (
            <Link key={action.href} href={action.href} className="admin-action-card">
              <strong>{action.title}</strong>
              <span>{action.note}</span>
            </Link>
          ))}
          <form method="post" action="/api/auth/logout">
            <button className="admin-signout-button" type="submit">
              <strong>Sign out</strong>
              <span>End this officer session</span>
            </button>
          </form>
        </nav>
      </section>

      <section className="admin-health-panel">
        <div className="admin-panel-head">
          <div>
            <div className="admin-page-eyebrow">Publication path</div>
            <h2>Spreadsheet to website</h2>
            <p>The Sheet is an officer workspace. Publication authority stays inside the signed-in review flow.</p>
          </div>
        </div>
        <ol className="admin-process">
          <li><strong>01 · Sync</strong><span>Copy Sheet rows into the private database archive.</span></li>
          <li><strong>02 · Review</strong><span>Open each private draft and approve it as a signed-in officer.</span></li>
          <li><strong>03 · Publish</strong><span>Approved records appear on the public site immediately.</span></li>
        </ol>
        <p className="admin-health-footnote">Sheet cells labeled Publish Decision or Public Safe are review notes only. They never publish by themselves.</p>
      </section>
    </div>
  );
}
