'use client';

import { useTransition, useState } from 'react';
import { triggerAltosIngestion } from './actions';
import type { AltosIngestionSummary } from '@/lib/ingestion/manual-ingestion-pilot';

interface Props {
  sourceEnabled: boolean;
  latestRun?: {
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    recordsSeen: number;
    recordsNew: number;
    recordsChanged: number;
    recordsUnchanged: number;
    errorMessage: string | null;
  } | null;
}

export function ManualIngestionForm({ sourceEnabled, latestRun }: Props) {
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState<AltosIngestionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRun() {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      try {
        const result = await triggerAltosIngestion();
        setSummary(result);
      } catch (err) {
        // Bound the error message — never display raw stack traces or payloads.
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
        setError(msg.slice(0, 300));
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Source status */}
      <div className="rounded-xl bg-white p-4 space-y-2" style={{ border: '1px solid var(--line)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--ink-soft)' }}>Source status:</span>
          <span
            className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
            style={{
              background: sourceEnabled ? 'var(--brand-soft)' : '#fee2e2',
              color: sourceEnabled ? 'var(--ink)' : '#991b1b',
            }}
          >
            {sourceEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {latestRun && (
          <div className="space-y-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
            <div>
              <span className="font-medium">Last run status:</span>{' '}
              <span style={{ color: 'var(--ink)' }}>{latestRun.status}</span>
            </div>
            {latestRun.startedAt && (
              <div>
                <span className="font-medium">Started:</span>{' '}
                {new Date(latestRun.startedAt).toLocaleString()}
              </div>
            )}
            {latestRun.finishedAt && (
              <div>
                <span className="font-medium">Finished:</span>{' '}
                {new Date(latestRun.finishedAt).toLocaleString()}
              </div>
            )}
            <div className="flex gap-4">
              <span><span className="font-medium">Seen:</span> {latestRun.recordsSeen}</span>
              <span><span className="font-medium">New:</span> {latestRun.recordsNew}</span>
              <span><span className="font-medium">Changed:</span> {latestRun.recordsChanged}</span>
              <span><span className="font-medium">Unchanged:</span> {latestRun.recordsUnchanged}</span>
            </div>
            {latestRun.errorMessage && (
              <div style={{ color: '#991b1b' }}>
                <span className="font-medium">Error:</span> {latestRun.errorMessage.slice(0, 300)}
              </div>
            )}
          </div>
        )}

        {!latestRun && (
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>No runs yet.</p>
        )}
      </div>

      {/* Notice */}
      <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 px-4 py-3" style={{ color: '#78350f' }}>
        Nothing is published automatically. New opportunities remain pending until an
        officer approves them in the review queue.
      </p>

      {/* Run button */}
      <button
        type="button"
        onClick={handleRun}
        disabled={isPending || !sourceEnabled}
        className="rounded-md px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: isPending ? 'var(--ink-soft)' : 'var(--ink)' }}
      >
        {isPending ? 'Running…' : 'Run ingestion'}
      </button>

      {/* Result summary */}
      {summary && (
        <div className="rounded-xl bg-white p-4 space-y-2" style={{ border: '1px solid var(--line)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            Run complete — status: <span style={{ color: summary.status === 'completed' ? '#15803d' : summary.status === 'failed' ? '#991b1b' : 'var(--ink)' }}>{summary.status}</span>
          </p>
          <div className="text-sm space-y-0.5" style={{ color: 'var(--ink-soft)' }}>
            <div>Records seen: {summary.recordsSeen}</div>
            <div>Records normalized: {summary.recordsNormalized}</div>
            <div>Records skipped: {summary.recordsSkipped}</div>
            <div>New: {summary.recordsNew} · Changed: {summary.recordsChanged} · Unchanged: {summary.recordsUnchanged}</div>
            <div>Review tasks created: {summary.recordsReviewed}</div>
            <div>Payload stored: {summary.payloadStored ? 'yes' : 'no'}</div>
            {summary.errorMessage && (
              <div style={{ color: '#991b1b' }}>Error: {summary.errorMessage.slice(0, 300)}</div>
            )}
          </div>
        </div>
      )}

      {/* Action-level error (e.g., auth failure, source not found) */}
      {error && (
        <div className="rounded-xl p-4 text-sm" style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}>
          {error}
        </div>
      )}
    </div>
  );
}
