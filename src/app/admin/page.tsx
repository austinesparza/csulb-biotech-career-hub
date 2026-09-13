// Admin dashboard home: review workload plus production operations health.
import Link from 'next/link';
import { loadDatabaseReleaseHealth } from '@/lib/database-release-health';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

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

function healthStyle(tone: 'good' | 'watch' | 'bad' | 'neutral') {
  if (tone === 'good') return { background: '#16653412', color: '#166534' };
  if (tone === 'watch') return { background: '#b4530916', color: '#92400e' };
  if (tone === 'bad') return { background: '#991b1b12', color: '#991b1b' };
  return { background: '#07567212', color: '#075672' };
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
      .select('id, source_name, enabled, automatic_scheduling_paused_at, consecutive_failures, degraded_at, last_attempted_at, last_successful_at, next_scheduled_at')
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

  const schemaTone = databaseRelease.status === 'current' ? 'good' : databaseRelease.status === 'drift' ? 'bad' : 'watch';
  const pipelineTone = cyclesResult.error
    ? 'watch'
    : lastCycle?.status === 'completed'
      ? 'good'
      : lastCycle?.status === 'failed'
        ? 'bad'
        : lastCycle?.status === 'partial'
          ? 'watch'
          : 'neutral';
  const queueTone = activeRunsResult.error ? 'watch' : staleQueue ? 'bad' : activeRuns.length > 0 ? 'neutral' : 'good';
  const sourceTone = sourceHealthResult.error ? 'watch' : degradedSources.length > 0 ? 'bad' : 'good';
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Officer dashboard</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
            Review workload and production pipeline health in one place.
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-xs font-semibold" style={healthStyle(operationsNeedAttention ? 'watch' : 'good')}>
          {operationsNeedAttention ? 'Operations need attention' : 'Operations healthy'}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-xl bg-white p-4 hover:bg-[var(--brand-soft)]"
            style={{ border: '1px solid var(--line)' }}>
            <div className="text-2xl font-semibold">{c.count}</div>
            <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>{c.label}</div>
          </Link>
        ))}
      </div>

      <section className="rounded-xl bg-white p-5" style={{ border: operationsNeedAttention ? '1px solid #b45309' : '1px solid var(--line)' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">Production health</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
              These checks distinguish review workload from actual ingestion, database, and worker failures.
            </p>
          </div>
          <Link href="/admin/sources" className="secondary-button">Open pipeline controls</Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {healthCards.map((card) => (
            <article key={card.label} className="rounded-lg p-4" style={{ border: '1px solid var(--line)' }}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold">{card.label}</h3>
                <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={healthStyle(card.tone)}>{card.value}</span>
              </div>
              <p className="mt-3 text-xs" style={{ color: 'var(--ink-soft)' }}>{card.detail}</p>
            </article>
          ))}
        </div>
        {degradedSources.length > 0 ? (
          <p className="mt-4 text-xs" style={{ color: 'var(--restricted)' }}>
            Degraded sources: {degradedSources.map((source) => source.source_name).join(', ')}. Open Automated Sources to inspect or pause them.
          </p>
        ) : null}
        {databaseRelease.status !== 'current' ? (
          <p className="mt-2 text-xs" style={{ color: 'var(--restricted)' }}>
            Application code expects database migration <code>{databaseRelease.expectedMigration}</code>. This warning never applies migrations automatically.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Recent pipeline cycles</h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-soft)' }}>Newest first. Partial and failed cycles remain visible instead of being reported as successful.</p>
          </div>
        </div>
        {cyclesResult.error ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--restricted)' }}>Pipeline telemetry could not be loaded.</p>
        ) : recentCycles.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: 'var(--ink-soft)' }}>No pipeline cycles have been recorded yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  <th className="pb-2 pr-4">Started</th>
                  <th className="pb-2 pr-4">Trigger</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Sources</th>
                  <th className="pb-2 pr-4">Records</th>
                  <th className="pb-2 pr-4">Review tasks</th>
                  <th className="pb-2">Sheet</th>
                </tr>
              </thead>
              <tbody>
                {recentCycles.map((cycle) => {
                  const tone = cycle.status === 'completed' ? 'good' : cycle.status === 'failed' ? 'bad' : 'watch';
                  return (
                    <tr key={cycle.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td className="py-3 pr-4 whitespace-nowrap">{when(cycle.started_at)}</td>
                      <td className="py-3 pr-4">{cycle.trigger_kind}</td>
                      <td className="py-3 pr-4">
                        <span className="rounded-full px-2 py-1 text-xs font-semibold" style={healthStyle(tone)}>{cycle.status}</span>
                        {errorCount(cycle.errors_json) > 0 ? <span className="ml-2 text-xs" style={{ color: 'var(--restricted)' }}>{errorCount(cycle.errors_json)} errors</span> : null}
                      </td>
                      <td className="py-3 pr-4">{cycle.completed_count ?? 0} ok · {cycle.partial_count ?? 0} partial · {cycle.failed_count ?? 0} failed</td>
                      <td className="py-3 pr-4">{cycle.records_seen ?? 0}</td>
                      <td className="py-3 pr-4">{cycle.review_tasks_created ?? 0}</td>
                      <td className="py-3">{sheetStatus(cycle.sheet_sync_json)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/admin/import" className="rounded-md px-4 py-2 font-medium text-white" style={{ background: 'var(--ink)' }}>
          Sync spreadsheet
        </Link>
        <Link href="/admin/add" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Add a posting
        </Link>
        <Link href="/admin/review" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Open review queue
        </Link>
        <Link href="/admin/manage" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Correct published records
        </Link>
        <Link href="/admin/duplicates" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Scan for duplicates
        </Link>
        <Link href="/admin/integrations" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Integration status
        </Link>
        <a href="/api/export?format=csv" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Export approved (CSV)
        </a>
        <form method="post" action="/api/auth/logout">
          <button className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
            Sign out
          </button>
        </form>
      </div>
      <section className="rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
        <h2 className="font-semibold">Spreadsheet to website</h2>
        <ol className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <li><strong>1. Sync</strong><br /><span style={{ color: 'var(--ink-soft)' }}>Copy Sheet rows into the private database archive.</span></li>
          <li><strong>2. Review</strong><br /><span style={{ color: 'var(--ink-soft)' }}>Open each private draft and approve it as a signed-in officer.</span></li>
          <li><strong>3. Publish</strong><br /><span style={{ color: 'var(--ink-soft)' }}>Approved records appear on the public site immediately.</span></li>
        </ol>
        <p className="mt-4 text-xs" style={{ color: 'var(--ink-soft)' }}>
          Sheet cells labeled Publish Decision or Public Safe are review notes only. They never publish by themselves.
        </p>
      </section>
    </div>
  );
}
