import { FOCUS_AREAS } from '@/lib/focusAreas';
import { sanitizeSearchTerm } from '@/lib/normalize';
import {
  normalizeOpportunityAudienceFilter,
} from '@/lib/opportunityAudience';
import { createPublicServerClient } from '@/lib/supabase/public-server';
import type { PublicOpportunity } from '@/lib/types';
import { Board } from './board';

export const dynamic = 'force-dynamic';

interface Search {
  q?: string;
  focus?: string;
  loc?: string;
  paid?: string;
  sort?: string;
  audience?: string;
}

export default async function InternshipsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = sanitizeSearchTerm(params.q);
  const focus = sanitizeSearchTerm(params.focus);
  const loc = sanitizeSearchTerm(params.loc);
  const paid = params.paid === 'paid' ? 'paid' : undefined;
  const sort = ['deadline', 'newest', 'company'].includes(params.sort ?? '') ? params.sort : undefined;
  const audience = normalizeOpportunityAudienceFilter(params.audience);
  const supabase = createPublicServerClient();
  const { data, error } = await supabase.rpc('search_public_opportunities', {
    p_query: q ?? null,
    p_focus: focus ?? null,
    p_location: loc ?? null,
    p_paid_only: !!paid,
    p_sort: sort ?? 'recommended',
    p_limit: 200,
  });
  const opportunities = (data ?? []) as PublicOpportunity[];

  return (
    <div className="site-wrap">
      <header className="page-head">
        <h1>Opportunities</h1>
        <p className="lede">
          Biotechnology internships, co-ops, and research roles. Compare the work,
          audience, timing, and source evidence before you apply.
        </p>
      </header>

      <section className="board-shell" aria-labelledby="board-title">
        <div className="section-head">
          <h2 id="board-title">Opportunity board</h2>
        </div>

        <form className="filters" id="opportunity-filters" method="get">
          <label className="filter-field filter-search">
            <span>Search</span>
            <input name="q" defaultValue={q ?? ''} placeholder="Employer, role, method, or location" maxLength={80} />
          </label>
          <label className="filter-field">
            <span>Discipline</span>
            <select name="focus" defaultValue={focus ?? ''}>
              <option value="">All disciplines</option>
              {FOCUS_AREAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span>Location</span>
            <input name="loc" defaultValue={loc ?? ''} placeholder="City, state, or remote" maxLength={40} />
          </label>
          <label className="filter-field">
            <span>Sort</span>
            <select name="sort" defaultValue={sort ?? ''}>
              <option value="">Recommended</option>
              <option value="deadline">Deadline</option>
              <option value="newest">Newest</option>
              <option value="company">Company A to Z</option>
            </select>
          </label>
          <button className="primary-button">Apply</button>
          <label className="filter-field" style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input name="paid" type="checkbox" value="paid" defaultChecked={!!paid} style={{ width: 17, minHeight: 17 }} />
            <span>Paid or stipend only</span>
          </label>
        </form>

        {error && <div className="notice"><span>!</span><span>Could not load opportunities. Please try again later.</span></div>}
        {!error && opportunities.length === 0 && (
          <div className="notice"><span>◇</span><span>No matching opportunities right now. Try another filter or <a href="/submit">submit a role</a>.</span></div>
        )}
        {opportunities.length > 0 && (
          <Board opportunities={opportunities} sorted={!!sort} initialAudience={audience} />
        )}
      </section>
    </div>
  );
}
