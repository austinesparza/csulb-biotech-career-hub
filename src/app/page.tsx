import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null, fallback = 'Awaiting first review') {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return fallback;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function opportunityDetails(opportunity: PublicOpportunity) {
  return [opportunity.location, opportunity.focus_area, opportunity.application_type]
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

export default async function HomePage() {
  const supabase = createClient();
  const { data } = await supabase
    .from('public_opportunities')
    .select('*')
    .order('first_seen_at', { ascending: false })
    .limit(200);
  const all = (data ?? []) as PublicOpportunity[];
  const graduate = all.filter((opportunity) => (
    opportunity.audience_bucket === 'graduate' || opportunity.audience_bucket === 'mixed'
  ));
  const companies = new Set(graduate.map((opportunity) => opportunity.company_name)).size;
  const lanes = new Set(graduate.flatMap((opportunity) => opportunity.scientific_lanes ?? [])).size;
  const checked = graduate
    .map((opportunity) => opportunity.last_checked_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const featured = graduate.slice(0, 4);

  return (
    <div className="home-editorial">
      <section className="editorial-hero site-wrap">
        <div className="editorial-hero-copy">
          <p className="editorial-overline">Students today. Brighter tomorrows.</p>
          <h1>Real opportunities<br />for what comes next.</h1>
          <p className="editorial-intro">
            A curated hub for CSULB biotechnology students to find internships,
            research, and career opportunities across the life sciences.
          </p>
          <div className="editorial-actions">
            <Link href="/internships" className="primary-button">Browse opportunities <span aria-hidden="true">→</span></Link>
            <Link href="/about" className="secondary-button">Learn how it works</Link>
          </div>
          <div className="editorial-proofline">
            <span aria-hidden="true" />
            Sources checked. Eligibility made clearer.
          </div>
        </div>

        <div className="science-collage" aria-label="An original microscopy-inspired visualization representing discovery in biotechnology">
          <div className="science-orbit science-orbit-one" aria-hidden="true" />
          <div className="science-orbit science-orbit-two" aria-hidden="true" />
          <div className="science-image">
            <Image
              src="/brand/cellular-field.webp"
              alt="Artistic fluorescence-microscopy-inspired view of interconnected cells"
              fill
              preload
              sizes="(max-width: 760px) 82vw, 42vw"
            />
          </div>
          <div className="science-caption science-caption-top" aria-hidden="true">Cells<br />systems<br />possibility</div>
          <div className="science-caption science-caption-bottom" aria-hidden="true">Different paths.<br />Shared purpose.</div>
          <div className="science-specimen" aria-hidden="true">
            <span>Field note</span>
            <strong>Curiosity<br />in motion</strong>
          </div>
        </div>
      </section>

      <section className="trust-ledger" aria-label="How the hub helps">
        <div className="site-wrap trust-ledger-inner">
          <article><span className="trust-number">01</span><div><h2>Curated &amp; relevant</h2><p>Opportunities selected for CSULB students.</p></div></article>
          <article><span className="trust-number">02</span><div><h2>Trusted sources</h2><p>Employer pages and evidence dates included.</p></div></article>
          <article><span className="trust-number">03</span><div><h2>Career-ready</h2><p>Requirements translated into useful signals.</p></div></article>
          <div className="trust-metrics" aria-label="Current board counts">
            <div><strong>{graduate.length}</strong><span>open roles</span></div>
            <div><strong>{companies}</strong><span>employers</span></div>
            <div><strong>{lanes}</strong><span>science lanes</span></div>
          </div>
        </div>
      </section>

      <section className="featured-ledger site-wrap" aria-labelledby="featured-title">
        <header className="editorial-section-label">
          <h2 id="featured-title">Featured opportunities</h2>
          <Link href="/internships">View all opportunities <span aria-hidden="true">→</span></Link>
        </header>

        {featured.length > 0 ? (
          <ol className="featured-list">
            {featured.map((opportunity) => (
              <li key={opportunity.id}>
                <a href={opportunity.posting_url ?? '/internships'}>
                  <span className="featured-company">{opportunity.company_name}</span>
                  <span className="featured-role">
                    <strong>{opportunity.title}</strong>
                    <small>{opportunityDetails(opportunity)}</small>
                  </span>
                  <time>{formatDate(opportunity.first_seen_at, 'Recently added')}</time>
                  <span className="featured-arrow" aria-hidden="true">→</span>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <div className="featured-empty">
            <p>The next reviewed opportunities will appear here.</p>
            <Link href="/internships">Explore the opportunity board</Link>
          </div>
        )}
      </section>

      <section className="mission-panel">
        <div className="site-wrap mission-grid">
          <div className="mission-index" aria-hidden="true">
            <span>CSULB / BIOTECH / 2026</span>
            <div className="mission-rings"><i /><i /><i /></div>
          </div>
          <div className="mission-copy">
            <p className="editorial-overline">Our mission</p>
            <h2>Connecting students to a healthier, more informed, more equitable world.</h2>
            <p>
              Biotechnology careers cross disciplines. This hub brings the source,
              eligibility evidence, and timing together so students can decide what
              deserves their attention.
            </p>
            <Link href="/about">Read about the project <span aria-hidden="true">→</span></Link>
          </div>
          <aside className="mission-note">
            <p>Evidence before urgency.</p>
            <p>Clarity before application.</p>
          </aside>
        </div>
      </section>

      <section className="pathways site-wrap" aria-labelledby="pathways-title">
        <header className="editorial-section-label">
          <h2 id="pathways-title">Find your next step</h2>
          <span>Different questions. One place to start.</span>
        </header>
        <div className="pathway-grid">
          <Link href="/internships"><span>01</span><h3>Opportunities</h3><p>Search current, reviewed roles by science, location, and timing.</p><b aria-hidden="true">→</b></Link>
          <Link href="/eligibility"><span>02</span><h3>Eligibility</h3><p>Understand degree stage, enrollment, and authorization language.</p><b aria-hidden="true">→</b></Link>
          <Link href="/calendar"><span>03</span><h3>Recruiting windows</h3><p>See deadlines now and patterns worth preparing for next.</p><b aria-hidden="true">→</b></Link>
        </div>
      </section>

      <div className="home-freshness site-wrap mono">
        Latest officer evidence check: <time>{formatDate(checked)}</time>
      </div>
    </div>
  );
}
