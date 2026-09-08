import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';

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
    .in('audience_bucket', ['graduate', 'mixed'])
    .order('deadline', { ascending: true, nullsFirst: false })
    .limit(200);
  const opportunities = (data ?? []) as PublicOpportunity[];
  const dated = opportunities.filter((o) => o.deadline);
  const rolling = opportunities.filter((o) => !o.deadline);

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
          <h2>Stated deadlines</h2>
          <p>{dated.length} current graduate-accessible role{dated.length === 1 ? '' : 's'} with a date.</p>
        </div>
        <div>
          {error && <div className="notice"><span>!</span><span>Could not load the calendar.</span></div>}
          {!error && dated.length === 0 && <p>No fixed deadlines are currently published on the reviewed board.</p>}
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
          </ol>
        </div>
      </section>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Open, no fixed date</h2>
          <p>Active records that require prompt checking because the source does not state a fixed close date.</p>
        </div>
        <div className="directory-grid">
          {rolling.map((o) => (
            <div className="directory-row" key={o.id}>
              <div>
                <h2>{o.company_name}</h2>
                <p>{o.title}</p>
                <p className="mono">{o.deadline_text ?? 'No deadline stated'}</p>
              </div>
              {o.posting_url && <a href={o.posting_url} target="_blank" rel="noopener noreferrer nofollow">↗</a>}
            </div>
          ))}
        </div>
      </section>
      <p style={{ paddingBottom: 64 }}><Link href="/internships">Return to the opportunity board</Link></p>
    </div>
  );
}
