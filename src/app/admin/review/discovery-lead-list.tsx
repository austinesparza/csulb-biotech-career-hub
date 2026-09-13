import type { DiscoveryLead, DiscoveryLeadObservationRow } from '@/lib/types';
import { updateDiscoveryLeadStatus } from './actions';

export interface DiscoveryLeadRow extends DiscoveryLead {
  latest_observation: DiscoveryLeadObservationRow | null;
}

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function metadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function triageSummary(metadata: Record<string, unknown>): string | null {
  const value = metadata.snippetTriage;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const triage = value as Record<string, unknown>;
  const score = typeof triage.score === 'number' ? triage.score : null;
  const bucket = typeof triage.suggestedBucket === 'string' ? triage.suggestedBucket.replaceAll('_', ' ') : null;
  if (score === null && !bucket) return null;
  return [score === null ? null : `score ${score}`, bucket].filter(Boolean).join(' · ');
}

export function DiscoveryLeadList({ rows }: { rows: DiscoveryLeadRow[] }) {
  if (!rows.length) return <p>No new or in-review discovery leads.</p>;

  return <ul className="review-records">{rows.map((row) => {
    const originalUrl = safeHttpsUrl(row.original_url);
    const canonicalUrl = safeHttpsUrl(row.canonical_employer_url);
    const observation = row.latest_observation;
    const provider = observation ? metadataText(observation.raw_metadata, 'provider') : null;
    const discoveryBasis = observation ? metadataText(observation.raw_metadata, 'discoveryBasis') : null;
    const triage = observation ? triageSummary(observation.raw_metadata) : null;
    return <li key={row.id} className="review-record">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <strong>{row.latest_title?.trim() || 'Untitled discovery lead'}</strong>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
            {row.employer_hint || 'Employer not identified'}
          </p>
        </div>
        <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: 'var(--brand-soft)' }}>
          {row.officer_status.replaceAll('_', ' ')}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--ink-soft)' }}>
        <span>{row.route.replaceAll('_', ' ')}</span>
        <span>{row.resolution.replaceAll('_', ' ')}</span>
        {row.lane ? <span>lane: {row.lane}</span> : null}
        <span>{row.occurrence_count} observation{row.occurrence_count === 1 ? '' : 's'}</span>
        <span>last seen {new Date(row.last_seen_at).toLocaleDateString()}</span>
      </div>

      {row.latest_snippet ? <p className="mt-3 whitespace-pre-wrap text-sm">{row.latest_snippet}</p> : null}
      <p className="mt-3 text-xs" style={{ color: 'var(--ink-soft)' }}>{row.archive_reason}</p>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {originalUrl ? <a href={originalUrl} target="_blank" rel="noreferrer">Open discovered page</a> : null}
        {canonicalUrl && canonicalUrl !== originalUrl
          ? <a href={canonicalUrl} target="_blank" rel="noreferrer">Open employer source</a>
          : null}
      </div>

      {observation ? <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-semibold">Latest discovery evidence</summary>
        <dl className="mt-2 grid gap-1">
          <div><dt className="inline font-semibold">Query: </dt><dd className="inline">{observation.query || 'Not recorded'}</dd></div>
          <div><dt className="inline font-semibold">Provider: </dt><dd className="inline">{provider || 'Not recorded'}</dd></div>
          <div><dt className="inline font-semibold">Basis: </dt><dd className="inline">{discoveryBasis?.replaceAll('_', ' ') || 'Not recorded'}</dd></div>
          {triage ? <div><dt className="inline font-semibold">Snippet triage: </dt><dd className="inline">{triage} (advisory only)</dd></div> : null}
          <div><dt className="inline font-semibold">Run: </dt><dd className="inline">{observation.run_id}</dd></div>
        </dl>
      </details> : null}

      {row.route === 'linkedin_lead' || row.resolution === 'linkedin_only' ? <p className="mt-3 text-xs font-semibold">
        LinkedIn is discovery evidence only. Verify an employer-controlled source before creating a draft.
      </p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {row.officer_status === 'new' ? <form action={updateDiscoveryLeadStatus}>
          <input type="hidden" name="id" value={row.id} />
          <button className="secondary-button" name="status" value="in_review">Start review</button>
        </form> : <form action={updateDiscoveryLeadStatus}>
          <input type="hidden" name="id" value={row.id} />
          <button className="secondary-button" name="status" value="new">Return to new</button>
        </form>}
        <form action={updateDiscoveryLeadStatus}>
          <input type="hidden" name="id" value={row.id} />
          <button className="secondary-button" name="status" value="archived">Archive lead</button>
        </form>
      </div>
    </li>;
  })}</ul>;
}
