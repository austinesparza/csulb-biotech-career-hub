import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';
import {
  HISTORICAL_ARCHIVE_SUMMARY,
  HISTORICAL_ROLE_ACTIVITY,
  RECRUITING_MONTHS,
  WATCHED_EMPLOYERS,
} from '@/lib/recruitingCalendar';
import { DeadlinePlanner } from './deadline-planner';
import { CalendarWatchlist } from './watchlist';

export const dynamic = 'force-dynamic';

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
  const activity = RECRUITING_MONTHS.map((month, monthIndex) => ({
    month,
    count: HISTORICAL_ROLE_ACTIVITY[monthIndex],
  }));
  const maxActivity = Math.max(...activity.map((month) => month.count), 1);

  return (
    <div className="site-wrap">
      <header className="page-head">
        <h1>Application calendar</h1>
        <p className="lede">
          Keep the dates that matter now, then use earlier cycles to know when to start looking.
          Every current deadline comes from a reviewed employer source.
        </p>
      </header>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Dates on the board</h2>
          <p>A calendar for stated deadlines. Roles without a fixed date stay separate below.</p>
        </div>
        <div>
          {error && <div className="notice"><span>!</span><span>Could not load the calendar.</span></div>}
          {!error && opportunities.length === 0 && <p>No current roles are available.</p>}
          {dated.length > 0 && <DeadlinePlanner deadlines={dated.map((o) => ({
            id: o.id,
            title: o.title,
            company: o.company_name,
            deadline: o.deadline!,
            location: o.location,
            url: o.posting_url,
          }))} />}
          {undated.length > 0 && <section className="undated-section" aria-labelledby="undated-title">
            <header>
              <h2 id="undated-title">Open without a fixed deadline</h2>
              <p>These roles are current, but the reviewed posting did not give us a calendar date.</p>
            </header>
            <ol className="undated-grid">
            {undated.map((o) => (
              <li key={o.id}>
                <span>Deadline not stated</span>
                <div>
                  <h3>{o.title}</h3>
                  <p><strong>{o.company_name}</strong>{o.location ? ` · ${o.location}` : ''}</p>
                  <p>{o.deadline_text ?? 'No deadline stated'}</p>
                  {o.posting_url && <p><a href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow">Official posting ↗</a></p>}
                </div>
              </li>
            ))}
            </ol>
          </section>}
        </div>
      </section>

      <section className="calendar-pattern" aria-labelledby="pattern-title">
        <div className="site-wrap calendar-pattern-grid">
          <div>
            <h2 id="pattern-title">Learning from our past searches.</h2>
            <p>
              Every dated role from the club&apos;s two supplied tracking cycles contributes
              to this chart. It shows when we found listings, not when an employer has
              promised to recruit again.
            </p>
            <dl className="calendar-history-metrics">
              <div><dt>Roles studied</dt><dd>{HISTORICAL_ARCHIVE_SUMMARY.roles}</dd></div>
              <div><dt>Cycles</dt><dd>{HISTORICAL_ARCHIVE_SUMMARY.cycles}</dd></div>
              <div><dt>Named employer records</dt><dd>{HISTORICAL_ARCHIVE_SUMMARY.namedEmployerRecords}</dd></div>
            </dl>
          </div>
          <ol className="calendar-bars" aria-label="Historical recruiting activity by month">
            {activity.map((item) => (
              <li key={item.month}>
                <span className="calendar-bar-count">{item.count}</span>
                <span className="calendar-bar-track">
                  <span style={{ height: `${Math.max(10, item.count / maxActivity * 100)}%` }} />
                </span>
                <span>{item.month}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="calendar-learning site-wrap" aria-labelledby="calendar-learning-title">
        <div>
          <span className="mono">A growing training record</span>
          <h2 id="calendar-learning-title">Past listings teach the search where to look next.</h2>
        </div>
        <div>
          <p>
            We preserve employer, role family, month first seen, audience, deadline language,
            location, source, and review outcome. Those labels can improve search ordering,
            surface recurring programs, and flag unusual changes across cycles.
          </p>
          <p>
            Two cycles are enough to guide attention, not enough for a confident forecast.
            As reviewed seasons accumulate, we can evaluate models against what actually
            appeared. Employer evidence still decides what reaches the public board.
          </p>
        </div>
      </section>

      <section className="calendar-watch-section site-wrap">
        <div className="margin-note">
          <h2>Search watchlist</h2>
          <p>
            Employers found in the club archive sit beside a wider biotechnology watch.
            An older appearance is a lead for discovery, never proof of a current opening.
          </p>
        </div>
        <CalendarWatchlist employers={WATCHED_EMPLOYERS} />
      </section>
      <p style={{ paddingBottom: 64 }}><Link href="/internships">Return to the opportunity board</Link></p>
    </div>
  );
}
