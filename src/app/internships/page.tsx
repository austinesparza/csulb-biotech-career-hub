// Student-facing Internship Exchange. Server component: fetches ONLY the
// public_opportunities view with sanitized filters, then hands the list to
// the client Board component (grouping, avatars, on-device personal tuning).
// Relevance scores drive ordering only and are never displayed here.
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
  after?: string;
  paid?: string;
  sort?: string;
}

export default async function InternshipsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const q = sanitizeSearchTerm(params.q);
  const focus = sanitizeSearchTerm(params.focus);
  const loc = sanitizeSearchTerm(params.loc);
  const after = /^\d{4}-\d{2}-\d{2}$/.test(params.after ?? '') ? params.after : undefined;
  const paid = params.paid === 'paid' ? 'paid' : undefined;
  const sort = ['deadline', 'newest', 'company'].includes(params.sort ?? '') ? params.sort : undefined;
  const supabase = createClient();

  let query = supabase.from('public_opportunities').select('*');
  if (q) query = query.or(`title.ilike.%${q}%,company_name.ilike.%${q}%`);
  if (focus) query = query.ilike('focus_area', `%${focus}%`);
  if (loc) query = query.ilike('location', `%${loc}%`);
  if (after) query = query.gte('deadline', after);
  if (paid) query = query.in('paid_status', ['paid', 'stipend']);
  query =
    sort === 'deadline'
      ? query.order('deadline', { ascending: true, nullsFirst: false })
      : sort === 'newest'
        ? query.order('first_seen_at', { ascending: false })
        : sort === 'company'
          ? query.order('company_name', { ascending: true })
          : query.order('relevance_score', { ascending: false, nullsFirst: false });

  const { data, error } = await query.limit(200);
  const opportunities = (data ?? []) as PublicOpportunity[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Internship Exchange</h1>
        <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          {opportunities.length} {opportunities.length === 1 ? 'opportunity' : 'opportunities'}
        </span>
      </div>

      <form className="flex flex-wrap gap-2 text-sm" method="get">
        <input name="q" defaultValue={q ?? ''} placeholder="Search title or company"
          aria-label="Search title or company" maxLength={80}
          className="min-w-40 flex-1 rounded-md bg-white px-3 py-2"
          style={{ border: '1px solid var(--line)' }} />
        <select name="focus" defaultValue={focus ?? ''} aria-label="Focus area"
          className="max-w-52 rounded-md bg-white px-2 py-2"
          style={{ border: '1px solid var(--line)' }}>
          <option value="">All focus areas</option>
          {FOCUS_AREAS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <input name="loc" defaultValue={loc ?? ''} placeholder="Location"
          aria-label="Location" maxLength={40}
          className="rounded-md bg-white px-3 py-2"
          style={{ border: '1px solid var(--line)' }} />
        <label className="flex items-center gap-1.5" style={{ color: 'var(--ink-soft)' }}>
          Deadline after
          <input name="after" type="date" defaultValue={after ?? ''}
            aria-label="Deadline after date"
            className="rounded-md bg-white px-2 py-1.5"
            style={{ border: '1px solid var(--line)', color: 'var(--ink)' }} />
        </label>
        <select name="paid" defaultValue={paid ?? ''} aria-label="Pay filter"
          className="rounded-md bg-white px-2 py-2"
          style={{ border: '1px solid var(--line)' }}>
          <option value="">Any pay</option>
          <option value="paid">Paid or stipend only</option>
        </select>
        <select name="sort" defaultValue={sort ?? ''} aria-label="Sort order"
          className="rounded-md bg-white px-2 py-2"
          style={{ border: '1px solid var(--line)' }}>
          <option value="">Sort: recommended</option>
          <option value="deadline">Sort: deadline</option>
          <option value="newest">Sort: newest</option>
          <option value="company">Sort: company A to Z</option>
        </select>
        <button className="rounded-md px-4 py-2 font-medium text-white" style={{ background: 'var(--ink)' }}>
          Filter
        </button>
      </form>

      {error && <p className="text-red-700">Could not load opportunities. Try again later.</p>}
      {!error && opportunities.length === 0 && (
        <p style={{ color: 'var(--ink-soft)' }}>
          No matching opportunities right now. Know of one?{' '}
          <a href="/submit" className="underline">Submit it</a>.
        </p>
      )}
      {opportunities.length > 0 && <Board opportunities={opportunities} sorted={!!sort} />}
    </div>
  );
}
