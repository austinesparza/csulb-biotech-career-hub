// Company Directory. Reads ONLY the public_companies view.
import { createClient } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

interface PublicCompany {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  industry_tags: string[];
  description: string | null;
  open_count: number;
}

export default async function CompaniesPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('public_companies')
    .select('*')
    .order('name');
  const companies = (data ?? []) as PublicCompany[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Company Directory</h1>
      <p className="max-w-2xl text-sm" style={{ color: 'var(--ink-soft)' }}>
        A historical record: organizations that have previously offered roles the club
        tracked, alongside any openings that are live right now (marked "open"). Listed
        for information only, not as an endorsement.
      </p>
      {error && <p className="text-red-700">Could not load companies. Try again later.</p>}
      {!error && companies.length === 0 && (
        <p style={{ color: 'var(--ink-soft)' }}>No companies published yet. Check back soon.</p>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {companies.map((c) => (
          <li key={c.id} className="rounded-xl bg-white p-4" style={{ border: '1px solid var(--line)' }}>
            <div className="flex items-center gap-3">
              <div aria-hidden="true"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-semibold"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand-deep)' }}>
                {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{c.name}</h2>
                  {c.open_count > 0 && (
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{ background: 'var(--brand-soft)', color: 'var(--brand-deep)' }}>
                      {c.open_count} open
                    </span>
                  )}
                </div>
                {c.location && <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>{c.location}</p>}
              </div>
            </div>
            {c.description && <p className="mt-2 text-sm">{c.description}</p>}
            {c.website && (
              <a href={c.website} target="_blank" rel="noopener noreferrer nofollow"
                className="mt-2 inline-block text-sm underline" style={{ color: 'var(--brand-deep)' }}>
                Website <span aria-hidden="true">↗</span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
