'use client';
// Client half of the Internship Exchange: bulletin-board grouping, monogram
// avatars, and on-device personal tuning. Data arrives as props from the
// server component, which reads ONLY the public_opportunities view.
// Preferences live in localStorage; nothing is sent to any server, which is
// what makes personalization compatible with the no-accounts policy.
import { useEffect, useMemo, useState } from 'react';
import { allFocusAreas } from '@/lib/focusAreas';
import type { PublicOpportunity } from '@/lib/types';

const PREFS_KEY = 'career-hub-prefs-v1';

interface Prefs {
  focus: string[];
  paid: boolean;
  remote: boolean;
  local: boolean;
  standing: string; // '', 'freshman', 'sophomore', 'junior', 'senior', 'graduate'
  term: string;     // '', 'spring', 'summer', 'fall', 'winter'
}
const EMPTY_PREFS: Prefs = { focus: [], paid: false, remote: false, local: false, standing: '', term: '' };

const STANDINGS = ['freshman', 'sophomore', 'junior', 'senior', 'graduate'] as const;
const TERMS = ['spring', 'summer', 'fall', 'winter'] as const;

const LOCAL_HINTS = /long beach|los angeles|orange|irvine|carson|torrance|carlsbad/i;

function prefsActive(p: Prefs): boolean {
  return p.focus.length > 0 || p.paid || p.remote || p.local || !!p.standing || !!p.term;
}

function personalBonus(o: PublicOpportunity, p: Prefs): { pts: number; why: string[] } {
  let pts = 0;
  const why: string[] = [];
  if (p.focus.length && o.focus_area && p.focus.includes(o.focus_area)) {
    pts += 15; why.push(`matches your focus: ${o.focus_area}`);
  }
  if (p.paid && (o.paid_status === 'paid' || o.paid_status === 'stipend')) {
    pts += 10; why.push('paid, your preference');
  }
  if (p.remote && /remote|hybrid/i.test(o.location ?? '')) {
    pts += 10; why.push('remote or hybrid, your preference');
  }
  if (p.local && LOCAL_HINTS.test(o.location ?? '')) {
    pts += 10; why.push('near Long Beach, your preference');
  }
  if (p.standing) {
    const elig = (o.eligibility ?? '').toLowerCase();
    if (elig.includes(p.standing)) {
      pts += 10; why.push(`open to ${p.standing}s`);
    } else if (/all students|all majors|undergrad/i.test(elig) && p.standing !== 'graduate') {
      pts += 5; why.push('open to all undergraduates');
    }
  }
  if (p.term) {
    const text = `${o.start_date_text ?? ''} ${o.title}`.toLowerCase();
    if (text.includes(p.term)) {
      pts += 8; why.push(`${p.term} term, your preference`);
    }
  }
  return { pts, why };
}

function initials(name: string): string {
  return name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join('') || '?';
}

function daysUntil(iso: string): number {
  return Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
}

function isFresh(o: PublicOpportunity): boolean {
  return Date.now() - Date.parse(o.first_seen_at) < 7 * 86_400_000;
}

export function Board({ opportunities, sorted }: { opportunities: PublicOpportunity[]; sorted: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) setPrefs({ ...EMPTY_PREFS, ...JSON.parse(raw) });
    } catch { /* corrupted prefs: start clean */ }
    setLoaded(true);
  }, []);

  const update = (next: Prefs) => {
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };

  // Canonical focus areas plus anything present in the data, so students can
  // express interest in categories that have no postings yet.
  const focuses = useMemo(
    () => allFocusAreas(opportunities.map((o) => o.focus_area)),
    [opportunities],
  );

  const active = loaded && prefsActive(prefs);
  const total = (o: PublicOpportunity) =>
    (o.relevance_score ?? 0) + (active ? personalBonus(o, prefs).pts : 0);

  let groups: Array<{ label: string | null; items: PublicOpportunity[] }>;
  if (sorted) {
    groups = [{ label: null, items: opportunities }]; // server already ordered
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
    ].filter((g) => g.items.length > 0);
  }

  return (
    <div className="space-y-2">
      <details className="rounded-xl bg-white p-4" style={{ border: '1px solid var(--line)' }}>
        <summary className="cursor-pointer text-sm font-semibold">
          Tune this board for you{' '}
          <span className="font-normal" style={{ color: 'var(--ink-soft)' }}>· optional, saved on this device only</span>
        </summary>
        <div className="mt-3 text-sm">
          {focuses.length > 0 && (
            <>
              <p className="text-xs font-semibold" style={{ color: 'var(--ink-soft)' }}>Focus areas I care about</p>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {focuses.map((f) => (
                  <label key={f} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={prefs.focus.includes(f)}
                      onChange={(e) =>
                        update({
                          ...prefs,
                          focus: e.target.checked ? [...prefs.focus, f] : prefs.focus.filter((x) => x !== f),
                        })
                      }
                    />
                    {f}
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prefs.paid} onChange={(e) => update({ ...prefs, paid: e.target.checked })} />
              Prefer paid or stipend
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prefs.remote} onChange={(e) => update({ ...prefs, remote: e.target.checked })} />
              Prefer remote or hybrid
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={prefs.local} onChange={(e) => update({ ...prefs, local: e.target.checked })} />
              Prefer near Long Beach
            </label>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1.5">
              My class standing
              <select value={prefs.standing} onChange={(e) => update({ ...prefs, standing: e.target.value })}
                className="rounded-md bg-white px-2 py-1" style={{ border: '1px solid var(--line)' }}>
                <option value="">Not set</option>
                {STANDINGS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Term I want
              <select value={prefs.term} onChange={(e) => update({ ...prefs, term: e.target.value })}
                className="rounded-md bg-white px-2 py-1" style={{ border: '1px solid var(--line)' }}>
                <option value="">Any term</option>
                {TERMS.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-2.5 text-xs" style={{ color: 'var(--ink-soft)' }}>
            When set, matching postings get a "match for you" boost in the recommended sort.
            This never hides anything, and nothing you pick leaves your device.{' '}
            <button type="button" className="underline" onClick={() => update(EMPTY_PREFS)}>Clear</button>
            {' · '}
            <a href="/about" className="underline">How scoring works</a>
          </p>
        </div>
      </details>

      {groups.map((g, gi) => (
        <div key={g.label ?? gi}>
          {g.label && (
            <h2 className="mb-2 mt-5 flex items-center gap-3 text-sm font-semibold" style={{ color: 'var(--ink-soft)' }}>
              {g.label}
              <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
            </h2>
          )}
          <ul className="space-y-3">
            {g.items.map((o) => {
              const bonus = active ? personalBonus(o, prefs) : { pts: 0, why: [] };
              return <OpportunityCard key={o.id} o={o} bonus={bonus} />;
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function OpportunityCard({ o, bonus }: { o: PublicOpportunity; bonus: { pts: number; why: string[] } }) {
  const urgent = !!o.deadline && daysUntil(o.deadline) >= 0 && daysUntil(o.deadline) <= 14;
  const deadlineText = o.deadline
    ? `Apply by ${new Date(o.deadline + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : (o.deadline_text ?? 'No deadline listed');

  return (
    <li className="rounded-xl bg-white p-4 sm:p-5" style={{ border: '1px solid var(--line)' }}>
      <div className="flex gap-3.5">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-semibold"
          style={{ background: 'var(--brand-soft)', color: 'var(--brand-deep)' }}
        >
          {initials(o.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {o.title}{' '}
              <span className="font-normal" style={{ color: 'var(--ink-soft)' }}>· {o.company_name}</span>
            </h3>
            <div className="flex flex-wrap gap-2 text-xs">
              {bonus.pts > 0 && (
                <span className="rounded-full bg-teal-50 px-2.5 py-0.5 font-medium text-teal-900" title={bonus.why.join(' · ')}>
                  match for you
                </span>
              )}
              {isFresh(o) && (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 font-medium text-blue-900">new this week</span>
              )}
              {(o.paid_status === 'paid' || o.paid_status === 'stipend') && (
                <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ background: 'var(--brand-soft)', color: 'var(--brand-deep)' }}>
                  {o.paid_status}
                </span>
              )}
              {o.paid_status === 'unpaid' && (
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-gray-700">unpaid</span>
              )}
              {o.status === 'open_unverified' && (
                <span className="rounded-full px-2.5 py-0.5 font-medium" style={{ background: 'var(--sand)', color: 'var(--sand-deep)' }}>
                  not yet re-verified
                </span>
              )}
            </div>
          </div>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>
            {[o.location, o.focus_area, o.eligibility].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-sm">
            <span className={urgent ? 'font-medium text-red-700' : ''} style={urgent ? {} : { color: 'var(--ink-soft)' }}>
              {deadlineText}
            </span>
            {o.start_date_text && <span style={{ color: 'var(--ink-soft)' }}> · {o.start_date_text}</span>}
          </p>
          {o.public_notes && <p className="mt-2 text-sm">{o.public_notes}</p>}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {o.posting_url ? (
              <a href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow"
                className="text-sm font-medium underline" style={{ color: 'var(--brand-deep)' }}>
                Apply at source <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>Ask a club officer for details</span>
            )}
            <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>
              {o.status === 'open_verified' && o.last_checked_at ? (
                <>
                  <span aria-hidden="true" style={{ color: 'var(--brand-deep)' }}>✓</span>
                  {` Verified by officers · checked ${new Date(o.last_checked_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                </>
              ) : o.source_name ? (
                `Source: ${o.source_name}`
              ) : (
                'Awaiting first check'
              )}
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
