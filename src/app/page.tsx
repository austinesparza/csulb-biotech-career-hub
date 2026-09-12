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

      <section className="mission-story" aria-labelledby="mission-title">
        <div className="site-wrap mission-story-grid">
          <figure className="mission-visual">
            <Image
              src="/brand/tissue-field.webp"
              alt="Abstract microscopy-inspired artwork of biological tissue"
              fill
              sizes="(max-width: 820px) 100vw, 40vw"
            />
          </figure>
          <div className="mission-statement">
            <h2 id="mission-title">What we learn about life can change how life is lived.</h2>
            <p>
              Across laboratories, data, manufacturing, and medicine, biotechnology
              carries discovery into the world. This hub helps CSULB students find
              a place in that work.
            </p>
            <div className="mission-links">
              <Link href="/about">Our story <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="biotech-pathways site-wrap" aria-labelledby="pathways-title">
        <header>
          <h2 id="pathways-title">See where the science can take you.</h2>
          <Link href="/internships">Explore every opportunity <span aria-hidden="true">→</span></Link>
        </header>
        <div className="biotech-pathway-grid">
          <Link href="/internships?q=research" className="biotech-pathway biotech-pathway-research">
            <Image src="/brand/cellular-field.webp" alt="Microscopy-inspired network of cells" fill sizes="(max-width: 700px) 100vw, 25vw" />
            <span><strong>Research</strong><small>Ask what no one knows yet.</small></span>
          </Link>
          <Link href="/internships?q=therapeutics" className="biotech-pathway biotech-pathway-therapeutics">
            <Image src="/brand/tissue-field.webp" alt="Microscopy-inspired biological tissue" fill sizes="(max-width: 700px) 100vw, 25vw" />
            <span><strong>Therapeutics</strong><small>Move an idea toward a patient.</small></span>
          </Link>
          <Link href="/internships?q=manufacturing" className="biotech-pathway biotech-pathway-manufacturing">
            <Image src="/brand/bioprocess-light.webp" alt="Precision work in a bright bioprocess laboratory" fill sizes="(max-width: 700px) 100vw, 25vw" />
            <span><strong>Biomanufacturing</strong><small>Make discovery reproducible.</small></span>
          </Link>
          <Link href="/internships?q=genomics" className="biotech-pathway biotech-pathway-genomics">
            <Image src="/brand/genomic-flow.webp" alt="Sequencing flow cell with abstract genomic patterns" fill sizes="(max-width: 700px) 100vw, 25vw" />
            <span><strong>Genomics &amp; data</strong><small>Find patterns biology hides.</small></span>
          </Link>
        </div>
      </section>

      <section className="home-coda" aria-label="Career hub closing statement">
        <div className="home-coda-image">
          <Image src="/brand/career-workbench.webp" alt="A biotechnology student reviewing application materials in a laboratory" fill sizes="(max-width: 760px) 100vw, 68vw" />
        </div>
        <div className="home-coda-copy">
          <p>Start with a question.<br />Leave with a direction.</p>
          <span className="mono">Latest review <time>{formatDate(checked)}</time></span>
        </div>
      </section>
    </div>
  );
}
