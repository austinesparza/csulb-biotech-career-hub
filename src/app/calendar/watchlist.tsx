'use client';

import { useMemo, useState } from 'react';
import { monthName, type WatchedEmployer, type WatchEvidence } from '@/lib/recruitingCalendar';

type WatchFilter = 'all' | WatchEvidence;

export function CalendarWatchlist({ employers }: { employers: WatchedEmployer[] }) {
  const [filter, setFilter] = useState<WatchFilter>('all');
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return employers.filter((item) => {
      if (filter !== 'all' && item.evidence !== filter) return false;
      if (!needle) return true;
      return `${item.employer} ${item.category} ${item.programTerms.join(' ')}`.toLowerCase().includes(needle);
    });
  }, [employers, filter, query]);

  const counts = {
    all: employers.length,
    archive: employers.filter((item) => item.evidence === 'club archive').length,
    broader: employers.filter((item) => item.evidence === 'broader search').length,
  };

  return (
    <div className="watchlist">
      <div className="watchlist-controls">
        <label>
          <span>Find an employer or field</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Genomics, research, Amgen..." />
        </label>
        <div className="watchlist-tabs" aria-label="Filter employer evidence">
          {([
            ['all', `All ${counts.all}`],
            ['club archive', `Seen before ${counts.archive}`],
            ['broader search', `Wider watch ${counts.broader}`],
          ] as const).map(([value, label]) => (
            <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="watchlist-count" aria-live="polite">{visible.length} search target{visible.length === 1 ? '' : 's'}</p>
      <ol className="watchlist-grid">
        {visible.map((item) => (
          <li key={item.employer}>
            <div className="watchlist-card-head">
              <span>{item.evidence === 'club archive' ? 'Seen in club records' : 'Wider biotech watch'}</span>
              <a href={item.source} target={item.source.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer nofollow" aria-label={`Open ${item.employer} careers page`}>↗</a>
            </div>
            <h3>{item.employer}</h3>
            <p>{item.category}</p>
            {item.observedMonths.length > 0 ? (
              <dl>
                <div><dt>First recorded</dt><dd>{item.observedMonths.map(monthName).join(', ')}</dd></div>
                <div><dt>Patterns to search</dt><dd>{item.programTerms.slice(0, 2).join(' · ')}</dd></div>
              </dl>
            ) : (
              <p className="watchlist-learning">No club-cycle timing yet. Search regularly and label what we find.</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
