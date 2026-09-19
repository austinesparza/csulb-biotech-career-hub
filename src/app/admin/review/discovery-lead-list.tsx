import type { DiscoveryLead, DiscoveryLeadObservationRow } from '@/lib/types';
import { resolveDiscoveryPromotion } from '@/lib/discovery-promotion';
import {
  addMissedDiscoveryRole,
  recordDiscoveryLeadDecision,
  updateDiscoveryLeadStatus,
} from './actions';
import {
  promoteAllVerifiedDiscoveryLeads,
  promoteDiscoveryLeadToDraft,
  promoteVerifiedLinkedInLead,
  resolveEmployerSourceAndPromote,
} from './discovery-promotion-actions';

export interface DiscoveryLeadRow extends DiscoveryLead {
  latest_observation: DiscoveryLeadObservationRow | null;
  shadow_prediction: { probability: number; modelStatus: 'shadow' | 'eligible' } | null;
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
          Discovery is only the first stage. Leads with an employer-controlled source can become private opportunity drafts in one step.
          If the employer only published a role directly on LinkedIn, use the verified first-party exception with separate employer-site evidence.
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

    <section className="review-publish-console" aria-labelledby="missed-role-title">
      <div className="review-publish-copy">
        <div className="admin-page-eyebrow">Recall training</div>
        <h2 id="missed-role-title">Add a role discovery missed</h2>
        <p>
          Paste a role you found manually, including on LinkedIn. This creates a private positive training example and a discovery lead.
          It does not scrape the page, copy the description, or publish anything.
        </p>
      </div>
      <form action={addMissedDiscoveryRole} className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1 text-xs font-semibold">
          Employer
          <input name="employer" required maxLength={500} className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }} />
        </label>
        <label className="grid gap-1 text-xs font-semibold">
          Role title
          <input name="title" required maxLength={500} className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }} />
        </label>
        <label className="grid gap-1 text-xs font-semibold md:col-span-2">
          Role URL
          <input name="url" type="url" inputMode="url" required placeholder="https://www.linkedin.com/jobs/view/..." className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }} />
        </label>
        <label className="grid gap-1 text-xs font-semibold md:col-span-2">
          Employer or ATS URL, if available
          <input name="employer_url" type="url" inputMode="url" placeholder="https://company.com/careers/job/..." className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }} />
        </label>
        <label className="grid gap-1 text-xs font-semibold md:col-span-2">
          Why this belongs in the Career Hub
          <textarea name="reason" required minLength={8} maxLength={1000} rows={3} className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }} />
        </label>
        <button type="submit" className="primary-button justify-self-start md:col-span-2">Save missed role</button>
      </form>
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
            {promotion.ready ? 'verified source' : row.officer_status.replaceAll('_', ' ')}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--ink-soft)' }}>
          <span>{row.route.replaceAll('_', ' ')}</span>
          <span>{row.resolution.replaceAll('_', ' ')}</span>
          {row.lane ? <span>lane: {row.lane}</span> : null}
          <span>{row.occurrence_count} observation{row.occurrence_count === 1 ? '' : 's'}</span>
          <span>last seen {new Date(row.last_seen_at).toLocaleDateString()}</span>
          {row.shadow_prediction ? <span>
            shadow relevance {Math.round(row.shadow_prediction.probability * 100)}% · not used for filtering
          </span> : null}
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
                <span>I verified this is an employer-controlled career page or an employer recruiting/ATS posting, not LinkedIn or a job aggregator.</span>
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
          Employer-controlled source resolved. This lead can move to the normal private opportunity-review queue.
        </p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {promotion.ready ? <form action={promoteDiscoveryLeadToDraft}>
            <input type="hidden" name="id" value={row.id} />
            <button className="primary-button">Promote to Review Queue</button>
          </form> : null}
          {row.officer_status === 'new' ? <form action={recordDiscoveryLeadDecision}>
            <input type="hidden" name="id" value={row.id} />
            <input type="hidden" name="label" value="relevant" />
            <input type="hidden" name="reason" value="Officer marked this lead relevant for further review." />
            <button className="secondary-button">Relevant, continue review</button>
          </form> : <form action={updateDiscoveryLeadStatus}>
            <input type="hidden" name="id" value={row.id} />
            <button className="secondary-button" name="status" value="new">Return to new</button>
          </form>}
        </div>
        <details className="mt-3 rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--paper-2)' }}>
          <summary className="cursor-pointer text-sm font-semibold">Close this lead with a reason</summary>
          <form action={recordDiscoveryLeadDecision} className="mt-3 grid gap-3">
            <input type="hidden" name="id" value={row.id} />
            <label className="grid gap-1 text-xs font-semibold">
              Outcome
              <select name="label" required className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }}>
                <option value="irrelevant">Irrelevant to students</option>
                <option value="duplicate">Duplicate of another lead</option>
                <option value="closed">Role already closed</option>
                <option value="unverifiable">Could not verify the source</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold">
              Evidence-based reason
              <textarea name="reason" required minLength={8} maxLength={1000} rows={2} className="rounded border bg-white px-3 py-2 text-sm font-normal" style={{ borderColor: 'var(--line-strong)' }} />
            </label>
            <button className="secondary-button justify-self-start">Save outcome + archive</button>
            <p className="text-xs" style={{ color: 'var(--ink-faint)' }}>
              Only “irrelevant” trains the negative class. Duplicate, closed, and unverifiable leads are excluded from model fitting.
            </p>
          </form>
        </details>
      </li>;
    })}</ul>
  </>;
}
