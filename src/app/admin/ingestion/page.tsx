import Link from 'next/link';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { ALTOS_BOARD_TOKEN } from '@/lib/ingestion/manual-ingestion-pilot';
import { ManualIngestionForm } from './manual-ingestion-form';

export const dynamic = 'force-dynamic';

export default async function IngestionPage() {
  await requireOfficer();
  const db = createServiceClient();

  // Load the Altos Labs job source
  const { data: source } = await db
    .from('job_sources')
    .select('id, source_name, source_identifier, enabled, last_attempted_at, last_successful_at, consecutive_failures')
    .eq('source_kind', 'greenhouse')
    .eq('source_identifier', ALTOS_BOARD_TOKEN)
    .maybeSingle();

  // Load the latest run for this source (if any)
  let latestRun: {
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    recordsSeen: number;
    recordsNew: number;
    recordsChanged: number;
    recordsUnchanged: number;
    errorMessage: string | null;
  } | null = null;

  if (source?.id) {
    const { data: run } = await db
      .from('source_fetch_runs')
      .select('status, started_at, finished_at, records_seen, records_new, records_changed, records_unchanged, error_message')
      .eq('job_source_id', source.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (run) {
      latestRun = {
        status: run.status,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        recordsSeen: run.records_seen ?? 0,
        recordsNew: run.records_new ?? 0,
        recordsChanged: run.records_changed ?? 0,
        recordsUnchanged: run.records_unchanged ?? 0,
        errorMessage: run.error_message ?? null,
      };
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Ingestion: Altos Labs Greenhouse</h1>
        <Link href="/admin" className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          ← Dashboard
        </Link>
      </div>

      {/* Source metadata */}
      <div className="rounded-xl bg-white p-4 space-y-1 text-sm" style={{ border: '1px solid var(--line)' }}>
        <div>
          <span className="font-medium">Source:</span>{' '}
          {source?.source_name ?? 'Altos Labs Greenhouse'}
        </div>
        <div>
          <span className="font-medium">Board token:</span>{' '}
          <code className="rounded px-1 py-0.5 text-xs" style={{ background: 'var(--brand-soft)' }}>
            {ALTOS_BOARD_TOKEN}
          </code>
        </div>
        {source && (
          <>
            {source.last_attempted_at && (
              <div>
                <span className="font-medium">Last attempted:</span>{' '}
                {new Date(source.last_attempted_at).toLocaleString()}
              </div>
            )}
            {source.last_successful_at && (
              <div>
                <span className="font-medium">Last successful:</span>{' '}
                {new Date(source.last_successful_at).toLocaleString()}
              </div>
            )}
            {typeof source.consecutive_failures === 'number' && source.consecutive_failures > 0 && (
              <div style={{ color: '#991b1b' }}>
                <span className="font-medium">Consecutive failures:</span> {source.consecutive_failures}
              </div>
            )}
          </>
        )}
        {!source && (
          <p style={{ color: '#991b1b' }}>
            Source not found — ensure migration 0007 has been applied.
          </p>
        )}
      </div>

      <ManualIngestionForm
        sourceEnabled={source?.enabled ?? false}
        latestRun={latestRun}
      />

      <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
        After ingestion, review new opportunities in the{' '}
        <Link href="/admin/review" className="underline" style={{ color: 'var(--ink)' }}>
          review queue
        </Link>
        .
      </p>
    </div>
  );
}
