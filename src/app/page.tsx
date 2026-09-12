import Image from 'next/image';
import Link from 'next/link';
import { companyLogoPath } from '@/lib/companyLogos';
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

const DISCIPLINES = [
  { label: 'Cancer & oncology', focus: 'Cancer and oncology', image: '/brand/discipline-cancer.webp', alt: 'Fluorescence microscopy of DNA in oral cancer cells' },
  { label: 'Genomics & genetics', focus: 'Genomics and genetics', image: '/brand/discipline-genomics.webp', alt: 'Fluorescence microscopy image from chromosome research' },
  { label: 'Single-cell & spatial', focus: 'Single-cell and spatial', image: '/brand/discipline-single-cell.webp', alt: 'Fluorescence microscopy of NEAT1 paraspeckles in human cells' },
  { label: 'Bioinformatics', focus: 'Bioinformatics and computational biology', image: '/brand/discipline-bioinformatics.webp', alt: 'Analyst preparing a sample in a DNA identification laboratory' },
  { label: 'Biological data science & ML', focus: 'Biological data science and ML', image: '/brand/discipline-data-science.webp', alt: 'Single-cell sequencing maps and data visualizations' },
  { label: 'Diagnostics & clinical data', focus: 'Diagnostics and clinical data', image: '/brand/discipline-diagnostics.webp', alt: 'Five-color confocal microscopy of plant cell organelles' },
  { label: 'Bioprocess & manufacturing', focus: 'Bioprocess and manufacturing science', image: '/brand/discipline-bioprocess.webp', alt: 'Cell-culture bioreactors in a laboratory' },
  { label: 'Protein science & drug discovery', focus: 'Protein science and drug discovery', image: '/brand/discipline-protein.webp', alt: 'Protein crystals viewed through a microscope' },
  { label: 'Neuroscience', focus: 'Neuroscience and neurodegeneration', image: '/brand/discipline-neuroscience.webp', alt: 'Fluorescence microscopy of green fluorescent neurons' },
  { label: 'Immunology & infectious disease', focus: 'Immunology and infectious disease', image: '/brand/discipline-immunology.webp', alt: 'Toxoplasma parasites inside a fibroblast host cell' },
] as const;

function FeaturedCompany({ name }: { name: string }) {
  const logo = companyLogoPath(name);
  return (
    <span className="featured-company">
      {logo ? <Image src={logo} alt={`${name} logo`} width={132} height={48} /> : name}
    </span>
  );
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
              src="/brand/hero-cells.webp"
              alt="Fluorescence microscopy of the cytoskeleton in cultured fibroblasts"
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
                  <FeaturedCompany name={opportunity.company_name} />
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
              src="/brand/mission-histology.webp"
              alt="Histology of basal-like breast cancer tissue"
              fill
              sizes="(max-width: 820px) 100vw, 40vw"
            />
          </figure>
          <div className="mission-statement">
            <h2 id="mission-title">Discovery should have somewhere to go.</h2>
            <p>
              From the first strange pattern under a microscope to a medicine that
              changes a life, biotechnology carries what we learn about living systems
              into the world.
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
          {DISCIPLINES.map((discipline) => (
            <Link
              key={discipline.focus}
              href={`/internships?focus=${encodeURIComponent(discipline.focus)}`}
              className="biotech-pathway"
            >
              <Image src={discipline.image} alt={discipline.alt} fill sizes="(max-width: 700px) 100vw, 33vw" />
              <span><strong>{discipline.label}</strong><b aria-hidden="true">→</b></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-coda" aria-label="Career hub closing statement">
        <div className="home-coda-image">
          <Image src="/brand/footer-lab.webp" alt="Scientists working in a DNA identification laboratory" fill sizes="(max-width: 760px) 100vw, 68vw" />
        </div>
        <div className="home-coda-copy">
          <p>Follow what makes you look closer.</p>
          <span className="mono">Latest review <time>{formatDate(checked)}</time></span>
        </div>
      </section>
    </div>
  );
}
