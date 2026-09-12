'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { companyLogoPath } from '@/lib/companyLogos';
import { allFocusAreas } from '@/lib/focusAreas';
import type { PublicOpportunity } from '@/lib/types';

const PREFS_KEY = 'career-hub-prefs-v1';
interface Prefs { focus: string[]; paid: boolean; remote: boolean; local: boolean; term: string; }
const EMPTY_PREFS: Prefs = { focus: [], paid: false, remote: false, local: false, term: '' };
const TERMS = ['spring', 'summer', 'fall', 'winter'] as const;
const LOCAL_HINTS = /long beach|los angeles|orange|irvine|carson|torrance|carlsbad/i;

function daysUntil(iso: string): number {
  return Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
}
function isFresh(o: PublicOpportunity): boolean {
  return Date.now() - Date.parse(o.first_seen_at) < 7 * 86_400_000;
}
function prefsActive(p: Prefs): boolean {
  return p.focus.length > 0 || p.paid || p.remote || p.local || !!p.term;
}
function personalBonus(o: PublicOpportunity, p: Prefs): { pts: number; why: string[] } {
  let pts = 0;
  const why: string[] = [];
  if (p.focus.length && o.focus_area && p.focus.includes(o.focus_area)) { pts += 15; why.push(`focus: ${o.focus_area}`); }
  if (p.paid && ['paid', 'stipend'].includes(o.paid_status)) { pts += 10; why.push('paid or stipend'); }
  if (p.remote && /remote|hybrid/i.test(o.location ?? '')) { pts += 10; why.push('remote or hybrid'); }
  if (p.local && LOCAL_HINTS.test(o.location ?? '')) { pts += 10; why.push('near Long Beach'); }
  if (p.term && `${o.start_date_text ?? ''} ${o.title}`.toLowerCase().includes(p.term)) { pts += 8; why.push(`${p.term} term`); }
  return { pts, why };
}
function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const SHORT_TAGS: Record<string, string> = {
  'Cancer and oncology': 'Oncology',
  'Genomics and genetics': 'Genomics',
  'Single-cell and spatial': 'Single-cell & spatial',
  'Bioinformatics and computational biology': 'Bioinformatics',
  'Biological data science and ML': 'Data science & ML',
  'Diagnostics and clinical data': 'Diagnostics',
  'Bioprocess and manufacturing science': 'Bioprocess',
  'Protein science and drug discovery': 'Drug discovery',
  'Neuroscience and neurodegeneration': 'Neuroscience',
  'Immunology and infectious disease': 'Immunology',
};

function opportunityTags(o: PublicOpportunity): string[] {
  const seen = new Set<string>();
  const discipline = [o.focus_area ?? '', ...(o.scientific_lanes ?? [])];
  const methods = o.methods ?? [];
  const fallback = o.job_functions ?? [];
  return [...discipline.slice(0, 1), ...methods.slice(0, 2), ...fallback]
    .map((tag) => SHORT_TAGS[tag] ?? tag)
    .filter((tag) => {
      const normalized = tag.trim().toLowerCase();
      if (!normalized || /^(?:(?:bio)?tech(?:nology)?|pharma(?:ceuticals?)?|life sciences?)$/.test(normalized)) return false;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 3);
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

function graduateStage(o: PublicOpportunity): string {
  const reviewed: Partial<Record<PublicOpportunity['graduate_stage'], string>> = {
    msc_year_1: 'First-year MSc student',
    msc_year_2: 'Second-year MSc student',
    msc_any: 'Current MSc student',
    mixed_graduate: 'Current MSc or PhD student',
    graduate_unspecified: 'Graduate student, year not specified',
  };
  if (o.graduate_stage && reviewed[o.graduate_stage]) return reviewed[o.graduate_stage]!;

  // Compatibility fallback for rows created before graduate_stage was added.
  const text = `${o.eligibility ?? ''} ${o.audience_reason ?? ''}`.toLowerCase();
  if (/first year completed|first program year/.test(text) && /continued enrollment|return/.test(text)) {
    return 'First-year MSc, returning for year two';
  }
  if (/master'?s or phd|master’s or phd/.test(text)) return 'Current MSc or PhD student';
  if (/post-baccalaureate, or master|explicitly includes master/.test(text)) return 'Current MSc student';
  if (/bachelor'?s or master|bachelor’s or master/.test(text) && /clarif|contradict|timing/.test(text)) {
    return 'MSc student, confirm graduation timing';
  }
  if (/graduate level is not restricted|graduate level is not excluded/.test(text)) {
    return 'Graduate student, confirm degree fit';
  }
  return 'Graduate student, year not specified';
}

export function Board({ opportunities, sorted }: {
  opportunities: PublicOpportunity[];
  sorted: boolean;
}) {
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
  const focuses = useMemo(() => allFocusAreas(opportunities.map((o) => o.focus_area)), [opportunities]);
  const active = loaded && prefsActive(prefs);
  const total = (o: PublicOpportunity) => (o.relevance_score ?? 0) + (active ? personalBonus(o, prefs).pts : 0);

  let groups: Array<{ label: string | null; items: PublicOpportunity[] }>;
  if (sorted) {
    groups = [{ label: null, items: opportunities }];
  } else {
    const byScore = (a: PublicOpportunity, b: PublicOpportunity) => total(b) - total(a);
    const closing = opportunities
      .filter((o) => o.deadline && daysUntil(o.deadline) >= 0 && daysUntil(o.deadline) <= 14)
      .sort((a, b) => daysUntil(a.deadline!) - daysUntil(b.deadline!));
    const fresh = opportunities.filter((o) => !closing.includes(o) && isFresh(o)).sort(byScore);
    const rest = opportunities.filter((o) => !closing.includes(o) && !fresh.includes(o)).sort(byScore);
    groups = [
      { label: 'Closing soon', items: closing },
      { label: 'New this week', items: fresh },
      { label: closing.length + fresh.length ? 'Everything else' : null, items: rest },
    ].filter((group) => group.items.length > 0);
  }

  return (
    <>
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

      <div className="ledger">
        {groups.map((group, groupIndex) => (
          <section key={group.label ?? groupIndex}>
            {group.label && <h2 className="ledger-group-title">{group.label}</h2>}
            <ol>
              {group.items.map((opportunity) => (
                <OpportunityRecord
                  key={opportunity.id}
                  opportunity={opportunity}
                  bonus={active ? personalBonus(opportunity, prefs) : { pts: 0, why: [] }}
                />
              ))}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}

function OpportunityRecord({ opportunity: o, bonus }: {
  opportunity: PublicOpportunity;
  bonus: { pts: number; why: string[] };
}) {
  const urgent = !!o.deadline && daysUntil(o.deadline) >= 0 && daysUntil(o.deadline) <= 14;
  const timing = o.deadline ? `Apply by ${formatDate(o.deadline + 'T00:00:00')}` : (o.deadline_text ?? 'No deadline stated');
  const eligibility = o.eligibility ?? 'Confirm the degree and enrollment requirements in the live posting.';
  const tags = opportunityTags(o);

  return (
    <li className="opportunity-record">
      <div className="record-aside">
        <CompanyMark name={o.company_name} />
        <div className="record-urgency">{urgent ? 'Closing soon' : (isFresh(o) ? 'New this week' : 'Review details')}</div>
      </div>
      <div>
        <div className="record-company">{o.company_name}</div>
        <h3 className="record-title">{o.title}</h3>
        {tags.length > 0 && (
          <div className="record-tags" aria-label="Disciplines and methods">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
        <div className="record-meta">
          {o.location && <span>{o.location}</span>}
          {o.start_date_text && <span>{o.start_date_text}</span>}
          <span>{o.paid_status === 'unknown' ? 'Pay not stated' : o.paid_status}</span>
        </div>
        <div className="record-actions">
          {o.posting_url
            ? <a className="primary-button" href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow">Official posting ↗</a>
            : <span className="record-verified">Ask a club officer for the source.</span>}
          {bonus.pts > 0 && <span className="pill pill-teal" title={bonus.why.join(', ')}>Match for you</span>}
          {isFresh(o) && <span className="pill pill-gold">New</span>}
          <span className={o.status === 'open_verified' ? 'pill pill-green' : 'pill pill-gold'}>
            {o.status === 'open_verified' ? 'Reviewed' : 'Check current status'}
          </span>
        </div>
        {o.public_notes && <p style={{ marginTop: 12, fontSize: '.86rem' }}>{o.public_notes}</p>}
      </div>
      <dl className="annotation">
        <dt>For</dt>
        <dd className="eligible">{graduateStage(o)}</dd>
        <dt style={{ marginTop: 12 }}>Requirements</dt>
        <dd>{eligibility}</dd>
      </dl>
      <dl className="annotation">
        <dt>Deadline or timing</dt>
        <dd>{timing}</dd>
        <dt style={{ marginTop: 12 }}>Evidence</dt>
        <dd className="record-verified">
          {o.last_checked_at ? `Checked ${formatDate(o.last_checked_at)}` : (o.source_name ? `Source: ${o.source_name}` : 'Awaiting first check')}
        </dd>
      </dl>
    </li>
  );
}
