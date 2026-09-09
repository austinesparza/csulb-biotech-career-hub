import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null) {
  if (!value) return 'Awaiting first review';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default async function HomePage() {
  const supabase = createClient();
  const { data } = await supabase
    .from('public_opportunities')
    .select('*')
    .order('first_seen_at', { ascending: false })
    .limit(200);
  const all = (data ?? []) as PublicOpportunity[];
  const graduate = all.filter((o) => o.audience_bucket === 'graduate' || o.audience_bucket === 'mixed');
  const companies = new Set(graduate.map((o) => o.company_name)).size;
  const deadlineCount = graduate.filter((o) => o.deadline).length;
  const checked = graduate
    .map((o) => o.last_checked_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  // This force-dynamic server page computes freshness once per request.
  // eslint-disable-next-line react-hooks/purity
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recent = graduate.filter((o) => Date.parse(o.first_seen_at) >= weekAgo).slice(0, 4);

  return (
    <>
      <div className="site-wrap">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">For graduate students</p>
            <h1 className="display">Find a graduate internship.</h1>
            <p className="lede">
              Browse internships in biotechnology, genomics, cancer research, bioinformatics, and
              diagnostics. We include the original posting, eligibility details, and the date each role was checked.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 28 }}>
              <Link href="/internships" className="primary-button">View internships</Link>
              <Link href="/eligibility" className="secondary-button">Check eligibility</Link>
            </div>
          </div>
          <aside className="hero-side" aria-label="Current board status">
            <div className="evidence-stamp mono">
              <span className="evidence-dot" />
              <span className="evidence-label">Latest officer evidence check</span>
              <time className="evidence-date">{formatDate(checked)}</time>
            </div>
            <div className="figures">
              <div className="figure"><strong>{graduate.length}</strong><span>open internships</span></div>
              <div className="figure"><strong>{companies}</strong><span>employers</span></div>
              <div className="figure"><strong>{deadlineCount}</strong><span>stated deadlines</span></div>
            </div>
          </aside>
        </section>

        <section className="editorial-strip" aria-labelledby="week-title">
          <div className="margin-note">
            <h2 id="week-title">This week</h2>
            <p>New internships reviewed by club officers.</p>
          </div>
          <div>
            {recent.length ? (
              <ol className="week-log">
                {recent.map((o) => (
                  <li className="week-item" key={o.id}>
                    <span className="week-tag">New role</span>
                    <span className="week-main"><strong>{o.company_name}</strong>: {o.title}</span>
                    <time className="week-when">{formatDate(o.first_seen_at)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="notice" style={{ marginTop: 0 }}>
                <span aria-hidden="true">◇</span>
                <span>No new internships were added in the last seven days.</span>
              </div>
            )}
          </div>
        </section>

        <section className="editorial-strip">
          <div className="margin-note">
            <h2>Before you apply</h2>
            <p>Check the role, the requirements, and the timing separately.</p>
          </div>
          <div className="directory-grid">
            <Link href="/internships" className="directory-row" style={{ textDecoration: 'none' }}>
              <div><h2>Is it open?</h2><p>Officer-reviewed status and evidence date.</p></div><span>01</span>
            </Link>
            <Link href="/internships" className="directory-row" style={{ textDecoration: 'none' }}>
              <div><h2>Is the science relevant?</h2><p>Methods, focus area, and role context.</p></div><span>02</span>
            </Link>
            <Link href="/eligibility" className="directory-row" style={{ textDecoration: 'none' }}>
              <div><h2>Can I apply?</h2><p>Degree stage, enrollment, graduation date, and work authorization.</p></div><span>03</span>
            </Link>
            <Link href="/calendar" className="directory-row" style={{ textDecoration: 'none' }}>
              <div><h2>When should I act?</h2><p>Current dates and past recruiting windows.</p></div><span>04</span>
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
