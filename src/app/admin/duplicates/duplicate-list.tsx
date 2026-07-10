'use client';
// Cluster resolution UI. "Keep this" marks every other record in the cluster
// as a duplicate pointing at the keeper, via the existing markDuplicate action
// (officer-verified server-side). Nothing is deleted.
import { useState, useTransition } from 'react';
import { markDuplicate } from '../review/actions';

export interface DupItem {
  id: string;
  title: string;
  company: string;
  posting_url: string | null;
  status: string;
  isPublic: boolean;
  last_seen_at: string;
}

export interface DupCluster {
  reason: string;
  confidence: 'high' | 'repost' | 'fuzzy';
  items: DupItem[];
}

const CONFIDENCE_STYLE: Record<DupCluster['confidence'], { bg: string; fg: string; label: string }> = {
  high: { bg: '#fcebeb', fg: '#791f1f', label: 'likely duplicate' },
  repost: { bg: 'var(--sand)', fg: 'var(--sand-deep)', label: 'possible repost' },
  fuzzy: { bg: '#f0efe9', fg: '#4c4e55', label: 'similar titles' },
};

export function DuplicateList({ clusters }: { clusters: DupCluster[] }) {
  if (clusters.length === 0) {
    return <p style={{ color: 'var(--ink-soft)' }}>No possible duplicates found. Clean board.</p>;
  }
  return (
    <ul className="space-y-4">
      {clusters.map((c, i) => <Cluster key={i} cluster={c} />)}
    </ul>
  );
}

function Cluster({ cluster }: { cluster: DupCluster }) {
  const [resolved, setResolved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const style = CONFIDENCE_STYLE[cluster.confidence];

  if (resolved) {
    return (
      <li className="rounded-xl bg-white p-4 text-sm" style={{ border: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
        Resolved: kept "{resolved}", marked {cluster.items.length - 1} as duplicate.
      </li>
    );
  }

  return (
    <li className="rounded-xl bg-white p-4 sm:p-5" style={{ border: '1px solid var(--line)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{cluster.reason}</span>
        <span className="rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: style.bg, color: style.fg }}>
          {style.label}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {cluster.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm"
            style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
            <span className="min-w-0">
              <span className="font-medium">{item.title}</span>
              <span style={{ color: 'var(--ink-soft)' }}> · {item.company}</span>
              <span className="ml-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
                {item.isPublic ? 'public' : item.status} · last seen {new Date(item.last_seen_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              {item.posting_url && (
                <a href={item.posting_url} target="_blank" rel="noopener noreferrer nofollow"
                  className="ml-2 text-xs underline" style={{ color: 'var(--brand-deep)' }}>
                  open <span aria-hidden="true">↗</span>
                </a>
              )}
            </span>
            <button
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  try {
                    for (const other of cluster.items) {
                      if (other.id !== item.id) await markDuplicate(other.id, item.id);
                    }
                    setResolved(item.title);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not resolve cluster');
                  }
                });
              }}
              className="rounded-md bg-white px-3 py-1 text-xs disabled:opacity-40"
              style={{ border: '1px solid var(--line)' }}
            >
              {pending ? 'Working…' : 'Keep this, mark others duplicate'}
            </button>
          </li>
        ))}
      </ul>
      {cluster.confidence === 'repost' && (
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
          Different seasons or years are usually separate postings. If both are real, no action needed.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
