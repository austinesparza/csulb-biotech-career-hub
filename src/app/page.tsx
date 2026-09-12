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
  const focusAreas = new Set(graduate.flatMap((opportunity) => opportunity.scientific_lanes ?? [])).size;
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
          <h1>Opportunities for what comes next.</h1>
          <p className="editorial-intro">
            A curated hub for CSULB biotechnology students to find internships,
            research, and career opportunities across the life sciences.
          </p>
          <div className="editorial-actions">
            <Link href="/internships" className="primary-button">Browse opportunities <span aria-hidden="true">→</span></Link>
            <Link href="/about" className="secondary-button">Learn how it works</Link>
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
        </div>
      </section>

      <section className="trust-ledger" aria-label="How the hub helps">
        <div className="site-wrap trust-ledger-inner">
          <article><div><h2>Curated &amp; relevant</h2><p>Opportunities selected for CSULB students.</p></div></article>
          <article><div><h2>Trusted sources</h2><p>Employer pages and evidence dates included.</p></div></article>
          <article><div><h2>Career-ready</h2><p>Requirements translated into useful signals.</p></div></article>
          <div className="trust-metrics" aria-label="Current board counts">
            <div><strong>{graduate.length}</strong><span>open roles</span></div>
            <div><strong>{companies}</strong><span>employers</span></div>
            <div><strong>{focusAreas}</strong><span>focus areas</span></div>
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

      <section className="mission-story">
        <div className="site-wrap mission-story-grid">
          <figure className="mission-visual">
            <Image
              src="/brand/tissue-field.webp"
              alt="Abstract microscopy-inspired artwork of biological tissue"
              fill
              sizes="(max-width: 820px) 100vw, 40vw"
            />
            <figcaption>Research · data · manufacturing · public health</figcaption>
          </figure>
          <div className="mission-statement">
            <p className="editorial-overline">Why this exists</p>
            <h2>Opportunity should not depend on already knowing where to look.</h2>
            <p>
              Biotechnology internships are scattered across employers, disciplines,
              and recruiting systems. This student-built hub brings credible openings,
              practical context, and preparation resources into one place.
            </p>
            <div className="mission-sequence" aria-label="Find, understand, prepare, and apply">
              <span>Find</span><i aria-hidden="true" />
              <span>Understand</span><i aria-hidden="true" />
              <span>Prepare</span><i aria-hidden="true" />
              <span>Apply</span>
            </div>
            <div className="mission-links">
              <Link href="/eligibility">Prepare for an internship <span aria-hidden="true">→</span></Link>
              <Link href="/about">How the hub works</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pathways site-wrap" aria-labelledby="pathways-title">
        <header className="editorial-section-label">
          <h2 id="pathways-title">Find your next step</h2>
          <span>Different questions. One place to start.</span>
        </header>
        <div className="pathway-grid">
          <Link href="/internships"><span>01</span><h3>Opportunities</h3><p>Search current, reviewed roles by science, location, and timing.</p><b aria-hidden="true">→</b></Link>
          <Link href="/eligibility"><span>02</span><h3>Prepare</h3><p>Know what to look for, build your materials, and apply with intention.</p><b aria-hidden="true">→</b></Link>
          <Link href="/calendar"><span>03</span><h3>Recruiting windows</h3><p>See deadlines now and patterns worth preparing for next.</p><b aria-hidden="true">→</b></Link>
        </div>
      </section>

      <div className="home-freshness site-wrap mono">
        Latest officer evidence check: <time>{formatDate(checked)}</time>
      </div>
    </div>
  );
}
