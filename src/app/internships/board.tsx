'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { companyLogoPath } from '@/lib/companyLogos';
import { allFocusAreas } from '@/lib/focusAreas';
import {
  companyContextLine,
  noteLabel,
  opportunityTags,
  postingLinkLabel,
  sourceEvidenceLabel,
  timingFallbackLabel,
} from '@/lib/opportunityCard';
import {
  opportunityAudienceLabel,
  opportunityMatchesAudience,
  type OpportunityAudienceFilter,
} from '@/lib/opportunityAudience';
import type { PublicOpportunity } from '@/lib/types';

const PREFS_KEY = 'career-hub-prefs-v1';
interface Prefs { focus: string[]; paid: boolean; remote: boolean; local: boolean; term: string; }
const EMPTY_PREFS: Prefs = { focus: [], paid: false, remote: false, local: false, term: '' };
const TERMS = ['spring', 'summer', 'fall', 'winter'] as const;
const LOCAL_HINTS = /long beach|los angeles|orange|irvine|carson|torrance|carlsbad/i;

function daysUntil(iso: string, referenceTime: number): number {
  const referenceDate = new Date(referenceTime).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${referenceDate}T00:00:00Z`)) / 86_400_000);
}
function isFresh(o: PublicOpportunity, referenceTime: number): boolean {
  const age = referenceTime - Date.parse(o.first_seen_at);
  return age >= 0 && age < 7 * 86_400_000;
}
function prefsActive(p: Prefs): boolean {
  return p.focus.length > 0 || p.paid || p.remote || p.local || !!p.term;
}
function matchesFocus(o: PublicOpportunity, focus: string): boolean {
  return o.focus_area === focus || (o.scientific_lanes ?? []).includes(focus);
}
function personalBonus(o: PublicOpportunity, p: Prefs): { pts: number; why: string[] } {
  let pts = 0;
  const why: string[] = [];
  const matchedFocus = p.focus.find((focus) => matchesFocus(o, focus));
  if (matchedFocus) { pts += 15; why.push(`focus: ${matchedFocus}`); }
  if (p.paid && ['paid', 'stipend'].includes(o.paid_status)) { pts += 10; why.push('paid or stipend'); }
  if (p.remote && /remote|hybrid/i.test(o.location ?? '')) { pts += 10; why.push('remote or hybrid'); }
  if (p.local && LOCAL_HINTS.test(o.location ?? '')) { pts += 10; why.push('near Long Beach'); }
  if (p.term && `${o.start_date_text ?? ''} ${o.title}`.toLowerCase().includes(p.term)) { pts += 8; why.push(`${p.term} term`); }
  return { pts, why };
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function companyInitials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
}

function CompanyMark({ name }: { name: string }) {
  const logo = companyLogoPath(name);
  return (
    <div className={`company-mark${logo ? ' company-mark-logo' : ''}`}>
      {logo ? (
        <Image src={logo} alt={`${name} logo`} width={112} height={52} />
      ) : (
        <span aria-label={name}>{companyInitials(name)}</span>
      )}
    </div>
  );
}

function payLabel(value: PublicOpportunity['paid_status']): string {
  if (value === 'unknown') return 'Pay not stated';
  if (value === 'stipend') return 'Stipend';
  return value[0].toUpperCase() + value.slice(1);
}

export function Board({ opportunities, sorted, initialAudience, referenceTime }: {
  opportunities: PublicOpportunity[];
  sorted: boolean;
  initialAudience?: OpportunityAudienceFilter;
  referenceTime: string;
}) {
  const [audience, setAudience] = useState<OpportunityAudienceFilter | undefined>(initialAudience);
  const [prefs, setPrefs] = useState<Prefs>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const hydrate = () => {
      try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (raw) setPrefs({ ...EMPTY_PREFS, ...JSON.parse(raw) });
      } catch { /* Keep defaults when local storage is unavailable. */ }
      setLoaded(true);
    };
    queueMicrotask(hydrate);
  }, []);
  const update = (next: Prefs) => {
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* Device-only preference is optional. */ }
  };
  const visibleOpportunities = useMemo(
    () => opportunities.filter((opportunity) => opportunityMatchesAudience(opportunity, audience)),
    [audience, opportunities],
  );
  const audienceCounts = useMemo(() => ({
    all: opportunities.length,
    undergraduate: opportunities.filter((opportunity) => opportunityMatchesAudience(opportunity, 'undergraduate')).length,
    graduate: opportunities.filter((opportunity) => opportunityMatchesAudience(opportunity, 'graduate')).length,
  }), [opportunities]);
  const focuses = useMemo(() => allFocusAreas(
    visibleOpportunities.flatMap((o) => (o.scientific_lanes?.length ? o.scientific_lanes : [o.focus_area])),
  ), [visibleOpportunities]);
  const active = loaded && prefsActive(prefs);
  const total = (o: PublicOpportunity) => (o.relevance_score ?? 0) + (active ? personalBonus(o, prefs).pts : 0);
  const referenceTimeMs = Date.parse(referenceTime);

  let groups: Array<{ label: string | null; items: PublicOpportunity[] }>;
  if (sorted) {
    groups = [{ label: null, items: visibleOpportunities }];
  } else {
    const byScore = (a: PublicOpportunity, b: PublicOpportunity) => total(b) - total(a);
    const closing = visibleOpportunities
      .filter((o) => o.deadline && daysUntil(o.deadline, referenceTimeMs) >= 0 && daysUntil(o.deadline, referenceTimeMs) <= 14)
      .sort((a, b) => daysUntil(a.deadline!, referenceTimeMs) - daysUntil(b.deadline!, referenceTimeMs));
    const fresh = visibleOpportunities.filter((o) => !closing.includes(o) && isFresh(o, referenceTimeMs)).sort(byScore);
    const rest = visibleOpportunities.filter((o) => !closing.includes(o) && !fresh.includes(o)).sort(byScore);
    groups = [
      { label: 'Closing soon', items: closing },
      { label: 'New this week', items: fresh },
      { label: closing.length + fresh.length ? 'Everything else' : null, items: rest },
    ].filter((group) => group.items.length > 0);
  }

  return (
    <>
      <div className="board-audience-row">
        <nav className="audience-switch" aria-label="Filter by student level">
          {([
            [undefined, 'All students', audienceCounts.all],
            ['undergraduate', 'Undergraduate', audienceCounts.undergraduate],
            ['graduate', 'Graduate', audienceCounts.graduate],
          ] as const).map(([value, label, count]) => (
            <button
              type="button"
              key={label}
              aria-pressed={audience === value}
              onClick={() => {
                setAudience(value);
                const url = new URL(window.location.href);
                if (value) url.searchParams.set('audience', value);
                else url.searchParams.delete('audience');
                window.history.replaceState(null, '', `${url.pathname}${url.search}`);
              }}
            >
              {label} <span>{count}</span>
            </button>
          ))}
        </nav>
        <p className="board-result-count" aria-live="polite">
          Showing {visibleOpportunities.length} of {opportunities.length} reviewed role{opportunities.length === 1 ? '' : 's'}
        </p>
        {audience && <input type="hidden" form="opportunity-filters" name="audience" value={audience} />}
      </div>

      <details className="preference-panel">
        <summary>Tune the board for you <span>optional, saved on this device only</span></summary>
        <div className="preference-content">
          {focuses.length > 0 && (
            <div>
              <strong>Focus areas</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 18px', marginTop: 7 }}>
                {focuses.map((focus) => (
                  <label key={focus}><input type="checkbox" checked={prefs.focus.includes(focus)}
                    onChange={(e) => update({ ...prefs, focus: e.target.checked ? [...prefs.focus, focus] : prefs.focus.filter((x) => x !== focus) })} /> {focus}</label>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '9px 20px', marginTop: 13 }}>
            <label><input type="checkbox" checked={prefs.paid} onChange={(e) => update({ ...prefs, paid: e.target.checked })} /> Prefer paid</label>
            <label><input type="checkbox" checked={prefs.remote} onChange={(e) => update({ ...prefs, remote: e.target.checked })} /> Prefer remote or hybrid</label>
            <label><input type="checkbox" checked={prefs.local} onChange={(e) => update({ ...prefs, local: e.target.checked })} /> Prefer near Long Beach</label>
            <label>Term: <select value={prefs.term} onChange={(e) => update({ ...prefs, term: e.target.value })} style={{ marginLeft: 4 }}>
              <option value="">Any</option>
              {TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
            </select></label>
            <button type="button" onClick={() => update(EMPTY_PREFS)} style={{ textDecoration: 'underline' }}>Clear</button>
          </div>
          <p style={{ color: 'var(--ink-faint)', marginTop: 10, fontSize: '.76rem' }}>
            Preferences change ordering only. They never hide roles and never leave this device.
          </p>
        </div>
      </details>

      {visibleOpportunities.length === 0 ? (
        <div className="notice"><span>◇</span><span>No roles match this student level. Try All students or another search.</span></div>
      ) : <div className="ledger">
        {groups.map((group, groupIndex) => (
          <section key={group.label ?? groupIndex}>
            {group.label && <h2 className="ledger-group-title">{group.label}</h2>}
            <ol>
              {group.items.map((opportunity) => (
                <OpportunityRecord
                  key={opportunity.id}
                  opportunity={opportunity}
                  bonus={active ? personalBonus(opportunity, prefs) : { pts: 0, why: [] }}
                  referenceTime={referenceTimeMs}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>}
    </>
  );
}

function OpportunityRecord({ opportunity: o, bonus, referenceTime }: {
  opportunity: PublicOpportunity;
  bonus: { pts: number; why: string[] };
  referenceTime: number;
}) {
  const urgent = !!o.deadline && daysUntil(o.deadline, referenceTime) >= 0 && daysUntil(o.deadline, referenceTime) <= 14;
  const deadlinePassed = !!o.deadline && daysUntil(o.deadline, referenceTime) < 0;
  const timing = o.deadline
    ? `${deadlinePassed ? 'Deadline passed' : 'Apply by'} ${formatDate(o.deadline + 'T00:00:00')}`
    : timingFallbackLabel(o.deadline_text);
  const eligibility = o.eligibility ?? 'Confirm the degree and enrollment requirements in the live posting.';
  const tags = opportunityTags(o);
  const companyContext = companyContextLine(o);
  const urgency = deadlinePassed
    ? 'Deadline passed'
    : urgent
      ? 'Closing soon'
      : isFresh(o, referenceTime)
        ? 'New this week'
        : null;

  return (
    <li className="opportunity-record">
      <div className="record-aside">
        <CompanyMark name={o.company_name} />
        {urgency && <div className="record-urgency">{urgency}</div>}
      </div>
      <div className="record-main">
        <div className="record-company">
          {o.company_website
            ? <a href={o.company_website} target="_blank" rel="noopener noreferrer nofollow">{o.company_name}</a>
            : o.company_name}
        </div>
        {companyContext && <div className="record-company-context">{companyContext}</div>}
        <h3 className="record-title">{o.title}</h3>
        {tags.length > 0 && (
          <div className="record-tags" aria-label="Disciplines and methods">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
        <div className="record-meta">
          {o.location && <span>{o.location}</span>}
          {o.start_date_text && <span>{o.start_date_text}</span>}
          <span>{payLabel(o.paid_status)}</span>
        </div>
        <div className="record-actions">
          {o.posting_url
            ? <a className="primary-button" href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow">{postingLinkLabel(o)}</a>
            : <span className="record-verified">Ask a club officer for the source.</span>}
          {bonus.pts > 0 && <span className="pill pill-teal" title={bonus.why.join(', ')}>Match for you</span>}
          {isFresh(o, referenceTime) && <span className="pill pill-gold">New</span>}
          <span className={!deadlinePassed && o.status === 'open_verified' ? 'pill pill-green' : 'pill pill-gold'}>
            {deadlinePassed ? 'Past deadline' : o.status === 'open_verified' ? 'Reviewed' : 'Check current status'}
          </span>
        </div>
        {o.public_notes && (
          <div className="record-public-note">
            <span>{noteLabel(o.public_notes)}</span>
            <p>{o.public_notes}</p>
          </div>
        )}
        {o.company_description && (
          <details className="record-company-details">
            <summary>About {o.company_name}</summary>
            <p>{o.company_description}</p>
            {o.company_location && <p className="record-company-location">Company locations: {o.company_location}</p>}
            {o.company_website && (
              <a href={o.company_website} target="_blank" rel="noopener noreferrer nofollow">Company website ↗</a>
            )}
          </details>
        )}
      </div>
      <dl className="annotation">
        <dt>For</dt>
        <dd className="eligible">{opportunityAudienceLabel(o)}</dd>
        <dt style={{ marginTop: 12 }}>Requirements</dt>
        <dd>{eligibility}</dd>
      </dl>
      <dl className="annotation">
        <dt>Deadline or timing</dt>
        <dd>{timing}</dd>
        <dt style={{ marginTop: 12 }}>Evidence</dt>
        <dd className="record-verified">{sourceEvidenceLabel(o)}</dd>
      </dl>
    </li>
  );
}
