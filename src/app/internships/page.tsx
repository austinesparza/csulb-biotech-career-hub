import { createClient } from '@/lib/supabase/client';
import { FOCUS_AREAS } from '@/lib/focusAreas';
import { sanitizeSearchTerm } from '@/lib/normalize';
import type { PublicOpportunity } from '@/lib/types';
import { Board } from './board';

export const dynamic = 'force-dynamic';

interface Search {
  q?: string;
  focus?: string;
  loc?: string;
  paid?: string;
  sort?: string;
}

export default async function InternshipsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = sanitizeSearchTerm(params.q);
  const focus = sanitizeSearchTerm(params.focus);
  const loc = sanitizeSearchTerm(params.loc);
  const paid = params.paid === 'paid' ? 'paid' : undefined;
  const sort = ['deadline', 'newest', 'company'].includes(params.sort ?? '') ? params.sort : undefined;
  const supabase = createClient();

  let query = supabase
    .from('public_opportunities')
    .select('*')
    .in('audience_bucket', ['graduate', 'mixed']);
  if (q) query = query.or(`title.ilike.%${q}%,company_name.ilike.%${q}%`);
  if (focus) query = query.ilike('focus_area', `%${focus}%`);
  if (loc) query = query.ilike('location', `%${loc}%`);
  if (paid) query = query.in('paid_status', ['paid', 'stipend']);
  query = sort === 'deadline'
    ? query.order('deadline', { ascending: true, nullsFirst: false })
    : sort === 'newest'
      ? query.order('first_seen_at', { ascending: false })
      : sort === 'company'
        ? query.order('company_name', { ascending: true })
        : query.order('relevance_score', { ascending: false, nullsFirst: false });

  const { data, error } = await query.limit(200);
  const opportunities = (data ?? []) as PublicOpportunity[];

  return (
    <div className="site-wrap">
      <header className="page-head">
        <h1>Graduate internships</h1>
        <p className="lede">
          Current roles reviewed for MSc eligibility, timing, and source evidence.
        </p>
      </header>

      <section className="board-shell" aria-labelledby="board-title">
        <div className="section-head">
          <div>
            <h2 id="board-title">Opportunity board</h2>
            <p className="mono" style={{ marginTop: 8 }}>{opportunities.length} reviewed result{opportunities.length === 1 ? '' : 's'}</p>
          </div>
          <p>Each record names its source and evidence date. Unknown values are shown as unknown.</p>
        </div>

        <form className="filters" method="get">
          <label className="filter-field filter-search">
            <span>Search</span>
            <input name="q" defaultValue={q ?? ''} placeholder="Employer, role, method, or location" maxLength={80} />
          </label>
          <label className="filter-field">
            <span>Scientific lane</span>
            <select name="focus" defaultValue={focus ?? ''}>
              <option value="">All lanes</option>
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
          <div className="notice"><span>◇</span><span>No matching graduate internships right now. Try another filter or <a href="/submit">submit a role</a>.</span></div>
        )}
        {opportunities.length > 0 && <Board opportunities={opportunities} sorted={!!sort} />}
      </section>
    </div>
  );
}
