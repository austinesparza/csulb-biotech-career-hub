// Company Directory. Current records come only from the public view. Historical
// roles are a labeled, non-current reference generated from the club archive.
import { createClient } from '@/lib/supabase/client';
import historicalData from '../../../data/historical-opportunities.json';
import {
  CompanyDirectory,
  type DirectoryCompany,
  type HistoricalRole,
  type PublicCompany,
} from './company-directory';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('public_companies')
    .select('*')
    .order('name');
  const companies = (data ?? []) as PublicCompany[];
  const historicalRoles = historicalData.roles as HistoricalRole[];
  const directory = buildDirectory(companies, historicalRoles);

  return (
    <div className="site-wrap company-page">
      <header className="page-head">
        <h1>Company directory</h1>
        <p className="lede">
          See who is hiring now and what appeared in earlier club searches. Historical
          roles are preserved for pattern-finding and are never presented as current openings.
        </p>
      </header>
      {error && <div className="notice"><span>!</span><span>Could not load companies. Try again later.</span></div>}
      <CompanyDirectory companies={directory} currentUnavailable={Boolean(error)} />
    </div>
  );
}

function directoryKey(name: string): string {
  return name.toLowerCase().replaceAll('&', 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildDirectory(current: PublicCompany[], historical: HistoricalRole[]): DirectoryCompany[] {
  const entries = new Map<string, DirectoryCompany>();

  for (const company of current) {
    entries.set(directoryKey(company.name), { ...company, historical_roles: [] });
  }

  for (const role of historical) {
    const key = directoryKey(role.company);
    const existing = entries.get(key);
    if (existing) {
      existing.historical_roles.push(role);
      continue;
    }
    entries.set(key, {
      id: `historical:${key}`,
      name: role.company,
      website: null,
      location: role.location,
      industry_tags: [role.focus],
      description: null,
      open_count: 0,
      historical_roles: [role],
    });
  }

  return [...entries.values()]
    .map((company) => ({
      ...company,
      historical_roles: company.historical_roles.toSorted((a, b) => (
        (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || a.title.localeCompare(b.title)
      )),
      industry_tags: [...new Set([
        ...(company.industry_tags ?? []),
        ...company.historical_roles.map((role) => role.focus),
      ])].filter(Boolean),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}
