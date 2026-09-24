import type { DiscoveryLead, DiscoveryLeadObservationRow } from '@/lib/types';
import { resolveDiscoveryPromotion } from '@/lib/discovery-promotion';
import { updateDiscoveryLeadStatus } from './actions';
import {
  promoteDiscoveryLeadToDraft,
  promoteVerifiedLinkedInLead,
  resolveEmployerSourceAndPromote,
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

function isDirectLinkedInJob(value: string | null): boolean {
  const url = safeHttpsUrl(value);
  if (!url) return false;
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return (host === 'linkedin.com' || host.endsWith('.linkedin.com'))
    && /^\/jobs\/view\//i.test(parsed.pathname);
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

  const sourceRecorded = rows.filter((row) => !!safeHttpsUrl(row.canonical_employer_url)).length;
  const unresolved = rows.length - sourceRecorded;

  return <>
    <section className="review-publish-console" aria-labelledby="discovery-promotion-title">
      <div className="review-publish-copy">
        <div className="admin-page-eyebrow">Discovery handoff</div>
        <h2 id="discovery-promotion-title">Check sources before opportunity review</h2>
        <p>
          A saved employer URL is only a lead. Check the live posting, Apply link, term and degree gates before creating a private opportunity draft. Known closed, off-cycle and undergraduate-only roles must remain out of the graduate review queue.
        </p>
      </div>
      <div className="review-publish-stats" aria-label="Discovery promotion status">
        <div><strong>{rows.length}</strong><span>active leads</span></div>
        <div><strong>{sourceRecorded}</strong><span>employer URL recorded</span></div>
        <div><strong>{unresolved}</strong><span>need employer URL</span></div>
        <div><strong>0</strong><span>auto-published</span></div>
      </div>
      <p className="mt-3 text-sm">Work through individual leads. A URL alone does not establish that the role is open or belongs on the graduate board.</p>
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
      const canUseLinkedInException = row.resolution === 'linkedin_only'
        && isDirectLinkedInJob(row.original_url)
        && !!row.employer_hint?.trim()
        && !!row.latest_title?.trim();

      return <li key={row.id} className="review-record">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <strong>{row.latest_title?.trim() || 'Untitled discovery lead'}</strong>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
              {row.employer_hint || 'Employer not identified'}
            </p>
          </div>
          <span className="rounded-full px-2 py-1 text-xs font-semibold" style={{ background: promotion.ready ? '#eef8f2' : 'var(--brand-soft)' }}>
            {promotion.ready ? 'employer URL recorded' : row.officer_status.replaceAll('_', ' ')}
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

        {!promotion.ready ? <>
          <p className="mt-3 text-xs font-semibold">
            {row.route === 'linkedin_lead' || row.resolution === 'linkedin_only'
              ? 'LinkedIn is discovery evidence only unless an officer verifies the narrow first-party exception below.'
              : promotion.reason}
          </p>
          {row.employer_hint?.trim() && row.latest_title?.trim() ? <details className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)' }}>
            <summary className="cursor-pointer text-sm font-semibold">I found the official employer posting</summary>
            <form action={resolveEmployerSourceAndPromote} className="mt-3 grid gap-3">
              <input type="hidden" name="id" value={row.id} />
              <label className="grid gap-1 text-xs font-semibold">
                Employer career or ATS URL
                <input
                  type="url"
                  name="employer_url"
                  required
                  inputMode="url"
                  placeholder="https://company.com/careers/job/..."
                  className="rounded border bg-white px-3 py-2 text-sm font-normal"
                  style={{ borderColor: 'var(--line-strong)' }}
                />
              </label>
              <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
                <input type="checkbox" name="source_confirmed" required className="mt-0.5" />
                <span>I verified this individual role is on the employer career site or its ATS, checked live Apply and read the degree, term and enrollment gates.</span>
              </label>
              <button type="submit" className="primary-button justify-self-start">Save source + promote to Review Queue</button>
              <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                This creates a private review draft only. It does not publish the opportunity.
              </p>
            </form>
          </details> : null}

          {canUseLinkedInException ? <details className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: '#fffdf5' }}>
            <summary className="cursor-pointer text-sm font-semibold">Only a first-party LinkedIn posting exists</summary>
            <form action={promoteVerifiedLinkedInLead} className="mt-3 grid gap-3">
              <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
                Use this only when the employer itself posted the role on LinkedIn and no role-specific employer or ATS page is available.
                Supply a separate employer-controlled page that supports the company identity or its recruiting channel.
              </p>
              <input type="hidden" name="id" value={row.id} />
              <label className="grid gap-1 text-xs font-semibold">
                Employer-site evidence URL
                <input
                  type="url"
                  name="employer_evidence_url"
                  required
                  inputMode="url"
                  placeholder="https://company.com/careers"
                  className="rounded border bg-white px-3 py-2 text-sm font-normal"
                  style={{ borderColor: 'var(--line-strong)' }}
                />
              </label>
              <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
                <input type="checkbox" name="linkedin_confirmed" required className="mt-0.5" />
                <span>I verified the LinkedIn job was published by the employer, the evidence URL is employer-controlled, and no role-specific employer/ATS posting is available.</span>
              </label>
              <button type="submit" className="secondary-button justify-self-start">Promote verified LinkedIn posting</button>
              <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
                The LinkedIn URL remains the source posting. This creates a private review draft only and never bypasses publication review.
              </p>
            </form>
          </details> : null}
        </> : <p className="mt-3 text-xs font-semibold" style={{ color: 'var(--teal-deep)' }}>
          Employer URL recorded. Verify the current Apply link and all structural gates before private promotion.
        </p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {promotion.ready ? <form action={promoteDiscoveryLeadToDraft}>
            <input type="hidden" name="id" value={row.id} />
            <label className="mb-2 flex items-start gap-2 text-xs"><input type="checkbox" name="posting_confirmed" required className="mt-0.5" />I checked live Apply, term, degree and enrollment requirements on this exact posting.</label>
            <button className="primary-button">Create private review draft</button>
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
