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
  const autumnPeakRoles = HISTORICAL_ROLE_ACTIVITY[2] + HISTORICAL_ROLE_ACTIVITY[3];
  const autumnPeakShare = Math.round(
    autumnPeakRoles / HISTORICAL_ARCHIVE_SUMMARY.datedRoles * 100,
  );

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
        <div className="calendar-pattern-summary">
          <p className="calendar-pattern-eyebrow">Historical timing</p>
          <h2 id="pattern-title">October and November carried most of the activity.</h2>
          <div className="calendar-season-insight">
            <strong>{autumnPeakShare}%</strong>
            <span>of dated roles in the archive appeared in those two months.</span>
          </div>
        </div>
        <div className="calendar-season">
          <p className="calendar-chart-label">Roles first seen by month</p>
          <ol className="calendar-bars" aria-label="Historical recruiting activity by month">
            {activity.map((item, index) => (
              <li
                key={item.month}
                className={index === 2 || index === 3 ? 'is-peak' : item.count > 0 ? 'has-activity' : undefined}
                aria-label={`${item.month}: ${item.count} roles`}
              >
                <span className="calendar-bar-count" aria-hidden="true">{item.count || ''}</span>
                <span className="calendar-bar-track" aria-hidden="true">
                  <span style={{ height: `${item.count / maxActivity * 100}%` }} />
                </span>
                <span>{item.month}</span>
              </li>
            ))}
          </ol>
          <p className="calendar-pattern-caveat">
            <strong>Start monitoring in September.</strong>
            <span>Past timing is a clue, not a deadline.</span>
          </p>
        </div>
        <p className="calendar-pattern-source">
          <span>{HISTORICAL_ARCHIVE_SUMMARY.roles} roles studied</span>
          <span>{HISTORICAL_ARCHIVE_SUMMARY.cycles} archived cycles</span>
          <span>{HISTORICAL_ARCHIVE_SUMMARY.datedRoles} roles with dated activity</span>
        </p>
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
