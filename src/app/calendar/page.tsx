import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';
import {
  RECRUITING_MONTHS,
  RECRUITING_WINDOWS,
  WATCHED_EMPLOYERS,
} from '@/lib/recruitingCalendar';

export const dynamic = 'force-dynamic';

function formatDate(value: string) {
  return new Date(value + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function CalendarPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('public_opportunities')
    .select('*')
    .in('audience_bucket', ['undergraduate', 'graduate', 'mixed'])
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(200);
  const opportunities = (data ?? []) as PublicOpportunity[];
  const dated = opportunities.filter((o) => o.deadline);
  const undated = opportunities.filter((o) => !o.deadline);

  return (
    <div className="site-wrap">
      <header className="page-head">
        <h1>Recruiting calendar</h1>
        <p className="lede">
          Historical timing is inferred from past recruiting cycles. Current openings and
          deadlines are shown only when a reviewed source states them.
        </p>
      </header>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Roles on the board</h2>
          <p>{opportunities.length} current reviewed role{opportunities.length === 1 ? '' : 's'}.</p>
        </div>
        <div>
          {error && <div className="notice"><span>!</span><span>Could not load the calendar.</span></div>}
          {!error && opportunities.length === 0 && <p>No current roles are available.</p>}
          <ol className="timeline-list">
            {dated.map((o) => (
              <li className="timeline-row" key={o.id}>
                <time className="timeline-date">{formatDate(o.deadline!)}</time>
                <div className="timeline-line">
                  <h2>{o.title}</h2>
                  <p><strong>{o.company_name}</strong>{o.location ? ` · ${o.location}` : ''}</p>
                  {o.posting_url && <p><a href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow">Official posting ↗</a></p>}
                </div>
              </li>
            ))}
            {undated.map((o) => (
              <li className="timeline-row" key={o.id}>
                <span className="timeline-date">Open, no fixed date</span>
                <div className="timeline-line timeline-line-open">
                  <h2>{o.title}</h2>
                  <p><strong>{o.company_name}</strong>{o.location ? ` · ${o.location}` : ''}</p>
                  <p>{o.deadline_text ?? 'No deadline stated'}</p>
                  {o.posting_url && <p><a href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow">Official posting ↗</a></p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Past recruiting windows</h2>
          <p>Use these ranges to decide when to start checking. They do not indicate a current opening.</p>
        </div>
        <div className="window-scroll" role="region" aria-label="Historical recruiting windows" tabIndex={0}>
          <div className="window-table">
            <div className="window-month-row" aria-hidden="true">
              <span />
              <div className="window-months">
                {RECRUITING_MONTHS.map((month) => <span key={month}>{month}</span>)}
              </div>
            </div>
            {RECRUITING_WINDOWS.map((item) => (
              <div className="window-row" key={item.employer}>
                <div className="window-employer">
                  <strong>{item.employer}</strong>
                  <span>{item.category}</span>
                </div>
                <div className="window-track">
                  <span
                    className="window-bar"
                    style={{ gridColumn: `${item.start + 1} / ${item.end + 2}` }}
                    title={`${item.timing}. ${item.note}`}
                  />
                </div>
                <div className="window-detail">
                  <strong>{item.timing}</strong>
                  <span>{item.note} <a href={item.source} target="_blank" rel="noopener noreferrer nofollow">Source ↗</a></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Watching</h2>
          <p>No reliable recruiting window yet.</p>
        </div>
        <div className="directory-grid">
          {WATCHED_EMPLOYERS.map((item) => (
            <a className="directory-row" href={item.source} target="_blank" rel="noopener noreferrer nofollow" key={item.employer} style={{ textDecoration: 'none' }}>
              <div><h2>{item.employer}</h2><p>{item.category}</p><p className="mono">{item.cadence}</p></div>
              <span>↗</span>
            </a>
          ))}
        </div>
      </section>
      <p style={{ paddingBottom: 64 }}><Link href="/internships">Return to the opportunity board</Link></p>
    </div>
  );
}
