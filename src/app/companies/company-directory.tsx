'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { companyLogoPath } from '@/lib/companyLogos';

export interface PublicCompany {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  industry_tags: string[];
  description: string | null;
  open_count: number;
}

export interface HistoricalRole {
  id: string;
  source: string;
  cycle: string;
  companyKey: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  eligibility: string | null;
  focus: string;
  deadlineText: string | null;
  startText: string | null;
  paidStatus: string;
  applicationType: string | null;
  notes: string | null;
  dateAdded: string | null;
}

export interface DirectoryCompany extends PublicCompany {
  historical_roles: HistoricalRole[];
}

type DirectoryFilter = 'all' | 'current' | 'archive';

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
}

export function CompanyDirectory({
  companies,
  currentUnavailable = false,
}: {
  companies: DirectoryCompany[];
  currentUnavailable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState<DirectoryFilter>('all');
  const sectors = useMemo(() => (
    [...new Set(companies.flatMap((company) => company.industry_tags ?? []))]
      .filter(Boolean)
      .toSorted((a, b) => a.localeCompare(b))
  ), [companies]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return companies.filter((company) => {
      const searchable = `${company.name} ${company.location ?? ''} ${(company.industry_tags ?? []).join(' ')} ${company.description ?? ''} ${company.historical_roles.map((role) => `${role.title} ${role.location ?? ''} ${role.focus}`).join(' ')}`.toLowerCase();
      return (!needle || searchable.includes(needle))
        && (!sector || company.industry_tags?.includes(sector))
        && (status === 'all'
          || (status === 'current' && company.open_count > 0)
          || (status === 'archive' && company.historical_roles.length > 0));
    });
  }, [companies, query, sector, status]);

  const currentCount = companies.filter((company) => company.open_count > 0).length;
  const archiveCount = companies.filter((company) => company.historical_roles.length > 0).length;
  const roleCount = companies.reduce((sum, company) => sum + company.historical_roles.length, 0);

  return (
    <>
      <div className="company-directory-summary">
        <div><strong>{currentCount}</strong><span>employers with current openings</span></div>
        <div><strong>{archiveCount}</strong><span>employers in earlier searches</span></div>
        <div><strong>{roleCount}</strong><span>historical roles preserved</span></div>
      </div>
      {currentUnavailable && (
        <p className="company-current-warning">Current employer data is temporarily unavailable. Historical records are still shown below.</p>
      )}
      <div className="company-status-tabs" aria-label="Show employers by record status">
        {([
          ['all', `All employers ${companies.length}`],
          ['current', `Current openings ${currentCount}`],
          ['archive', `Historical record ${archiveCount}`],
        ] as const).map(([value, label]) => (
          <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>
        ))}
      </div>
      <div className="company-filters" aria-label="Company directory filters">
        <label>
          <span>Search</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, location, or sector" />
        </label>
        <label>
          <span>Sector</span>
          <select value={sector} onChange={(event) => setSector(event.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </label>
        <span className="company-result-count">{filtered.length} employer{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="company-empty">No employers match those filters.</p>
      ) : (
        <ul className="company-directory-grid">
          {filtered.map((company) => {
            const logo = companyLogoPath(company.name);
            return (
              <li key={company.id} className="company-directory-card">
                <div className="company-directory-topline">
                  <div className={`company-directory-mark${logo ? ' has-logo' : ''}`}>
                    {logo
                      ? <Image src={logo} alt={`${company.name} logo`} width={150} height={58} />
                      : <span aria-hidden="true">{initials(company.name)}</span>}
                  </div>
                  <div className="company-record-badges">
                    {company.open_count > 0 && <span className="company-current-badge">Current</span>}
                    {company.historical_roles.length > 0 && <span className="company-archive-badge">Archive</span>}
                  </div>
                </div>
                <div className="company-directory-heading">
                  <h2>{company.name}</h2>
                </div>
                {company.location && <p className="company-location">{company.location}</p>}
                {company.industry_tags?.length > 0 && (
                  <div className="company-tags">
                    {company.industry_tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
                {company.description && <p className="company-description">{company.description}</p>}
                {company.historical_roles.length > 0 && (
                  <details className="company-history">
                    <summary>{company.historical_roles.length} earlier role{company.historical_roles.length === 1 ? '' : 's'}</summary>
                    <ol>
                      {company.historical_roles.map((role) => (
                        <li key={role.id}>
                          <div><span>{role.cycle}</span><span>{role.focus}</span></div>
                          <h3>{role.title}</h3>
                          <p>{[role.location, role.deadlineText].filter(Boolean).join(' · ')}</p>
                          <a href={role.url} target="_blank" rel="noopener noreferrer nofollow">Archived source <span aria-hidden="true">↗</span></a>
                        </li>
                      ))}
                    </ol>
                    <p className="company-history-note">Past listing. Use it to recognize a program or search window, not as proof that applications are open now.</p>
                  </details>
                )}
                <div className="company-links">
                  {company.open_count > 0 && <Link href={`/internships?q=${encodeURIComponent(company.name)}`}>See {company.open_count} current opening{company.open_count === 1 ? '' : 's'} <span aria-hidden="true">→</span></Link>}
                  {company.website && <a href={company.website} target="_blank" rel="noopener noreferrer nofollow">Company site <span aria-hidden="true">↗</span></a>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
