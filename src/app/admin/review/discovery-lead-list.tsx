import type { DiscoveryLead, DiscoveryLeadObservationRow } from '@/lib/types';
import { resolveDiscoveryPromotion } from '@/lib/discovery-promotion';
import { updateDiscoveryLeadStatus } from './actions';
import {
  promoteAllVerifiedDiscoveryLeads,
  promoteDiscoveryLeadToDraft,
} from './discovery-promotion-actions';

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

  const promotable = rows.filter((row) => resolveDiscoveryPromotion({
    resolution: row.resolution,
    canonicalEmployerUrl: row.canonical_employer_url,
    employerHint: row.employer_hint,
    title: row.latest_title,
  }).ready).length;
  const unresolved = rows.length - promotable;

  return <>
    <section className="review-publish-console" aria-labelledby="discovery-promotion-title">
      <div className="review-publish-copy">
        <div className="admin-page-eyebrow">Discovery handoff</div>
        <h2 id="discovery-promotion-title">Move verified leads into opportunity review</h2>
        <p>
          Discovery is only the first stage. Leads with an employer-controlled source can now become private opportunity drafts in one step.
          LinkedIn-only and unresolved leads remain here until provenance is resolved.
        </p>
      </div>
      <div className="review-publish-stats" aria-label="Discovery promotion status">
        <div><strong>{rows.length}</strong><span>active leads</span></div>
        <div><strong>{promotable}</strong><span>verified source</span></div>
        <div><strong>{unresolved}</strong><span>need source resolution</span></div>
        <div><strong>0</strong><span>auto-published</span></div>
      </div>
      <div className="review-publish-action">
        <div>
          <strong>Safe bulk handoff</strong>
          <p>
            Creates private <code>needs_review</code> opportunities only. Nothing becomes public until an officer reviews and approves the posting.
          </p>
        </div>
        <form action={promoteAllVerifiedDiscoveryLeads}>
          <button type="submit" className="primary-button" disabled={promotable === 0}>
            Promote {promotable} verified lead{promotable === 1 ? '' : 's'}
          </button>
        </form>
      </div>
    </section>

    <ul className="review-records">{rows.map((row) => {
      const originalUrl = safeHttpsUrl(row.original_url);
      const canonicalUrl = safeHttpsUrl(row.canonical_employer_url);
      const observation = row.latest_observation;
      const provider = observation ? metadataText(observation.raw_metadata, 'provider') : null;
      const discoveryBasis = observation ? metadataText(observation.raw_metadata, 'discoveryBasis') : null;
      const triage = observation ? triageSummary(observation.raw_metadata) : null;
      const promotion = resolveDiscoveryPromotion({
        resolution: row.resolution,
        canonicalEmployerUrl: row.canonical_employer_url,
        employerHint: row.employer_hint,
        title: row.latest_title,
      });

      return <li key={row.id} className="review-record">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <strong>{row.latest_title?.trim() || 'Untitled discovery lead'}</strong>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
              {row.employer_hint || 'Employer not identified'}
            </p>
          </div>
          <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: promotion.ready ? '#eef8f2' : 'var(--brand-soft)' }}>
            {promotion.ready ? 'verified source' : row.officer_status.replaceAll('_', ' ')}
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

        {!promotion.ready ? <p className="mt-3 text-xs font-semibold">
          {row.route === 'linkedin_lead' || row.resolution === 'linkedin_only'
            ? 'LinkedIn is discovery evidence only. Resolve an employer-controlled source before promotion.'
            : promotion.reason}
        </p> : <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--teal-deep)' }}>
          Employer-controlled source resolved. This lead can move to the normal private opportunity-review queue.
        </p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {promotion.ready ? <form action={promoteDiscoveryLeadToDraft}>
            <input type="hidden" name="id" value={row.id} />
            <button className="primary-button">Promote to Review Queue</button>
          </form> : null}
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
    })}</ul>
  </>;
}
