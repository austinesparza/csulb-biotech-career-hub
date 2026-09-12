import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';
import {
  RECRUITING_MONTHS,
  RECRUITING_WINDOWS,
  WATCHED_EMPLOYERS,
} from '@/lib/recruitingCalendar';
import { DeadlinePlanner } from './deadline-planner';

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
    count: RECRUITING_WINDOWS.filter((window) => monthIndex >= window.start && monthIndex <= window.end).length,
  }));
  const maxActivity = Math.max(...activity.map((month) => month.count), 1);

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
          <h2>Deadlines you can keep</h2>
          <p>Select the roles you care about and download reminders for your calendar.</p>
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
          {undated.length > 0 && <ol className="timeline-list timeline-undated">
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
          </ol>}
        </div>
      </section>

      <section className="calendar-pattern" aria-labelledby="pattern-title">
        <div className="site-wrap calendar-pattern-grid">
          <div>
            <h2 id="pattern-title">Start looking before the listings arrive.</h2>
            <p>
              This chart counts employers in our past-cycle evidence by the months
              when their recruiting windows have been active. It is a search cue,
              not a forecast.
            </p>
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

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Past recruiting windows</h2>
          <p>Past-cycle reference only. These ranges do not indicate a current opening.</p>
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
                  <span>{item.category} · past-cycle pattern</span>
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
