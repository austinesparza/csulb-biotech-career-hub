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

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('');
}

export function CompanyDirectory({ companies }: { companies: PublicCompany[] }) {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const sectors = useMemo(() => (
    [...new Set(companies.flatMap((company) => company.industry_tags ?? []))]
      .filter(Boolean)
      .toSorted((a, b) => a.localeCompare(b))
  ), [companies]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return companies.filter((company) => {
      const searchable = `${company.name} ${company.location ?? ''} ${(company.industry_tags ?? []).join(' ')} ${company.description ?? ''}`.toLowerCase();
      return (!needle || searchable.includes(needle))
        && (!sector || company.industry_tags?.includes(sector))
        && (!openOnly || company.open_count > 0);
    });
  }, [companies, openOnly, query, sector]);

  return (
    <>
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
        <label className="company-open-filter">
          <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
          <span>Open roles only</span>
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
                <div className={`company-directory-mark${logo ? ' has-logo' : ''}`}>
                  {logo
                    ? <Image src={logo} alt={`${company.name} logo`} width={150} height={58} />
                    : <span aria-hidden="true">{initials(company.name)}</span>}
                </div>
                <div className="company-directory-heading">
                  <h2>{company.name}</h2>
                  {company.open_count > 0 && <span>{company.open_count} open</span>}
                </div>
                {company.location && <p className="company-location">{company.location}</p>}
                {company.industry_tags?.length > 0 && (
                  <div className="company-tags">
                    {company.industry_tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                )}
                {company.description && <p className="company-description">{company.description}</p>}
                <div className="company-links">
                  <Link href={`/internships?q=${encodeURIComponent(company.name)}`}>View roles <span aria-hidden="true">→</span></Link>
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
