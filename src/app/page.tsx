import Image from 'next/image';
import Link from 'next/link';
import { companyLogoAsset } from '@/lib/companyLogos';
import { createClient } from '@/lib/supabase/client';
import type { PublicOpportunity } from '@/lib/types';
import disciplineBioprocess from '../../public/brand/discipline-bioprocess.webp';
import disciplineCancer from '../../public/brand/discipline-cancer.webp';
import disciplineDataScience from '../../public/brand/discipline-data-science.webp';
import disciplineGenomics from '../../public/brand/discipline-genomics.webp';
import disciplineImmunology from '../../public/brand/discipline-immunology.webp';
import disciplineProtein from '../../public/brand/discipline-protein.webp';
import heroEpithelialCells from '../../public/brand/hero-epithelial-cells.webp';
import missionHistology from '../../public/brand/mission-histology.webp';
import zebrafishVasculature from '../../public/brand/zebrafish-vasculature.webp';

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
  { label: 'Cancer & oncology', focus: 'Cancer and oncology', description: 'Tumor biology, biomarkers, therapeutics, and translational research.', image: disciplineCancer, alt: 'Fluorescence microscopy of DNA in oral cancer cells' },
  { label: 'Genomics & genetics', focus: 'Genomics and genetics', description: 'Genome science, functional genetics, and variant-focused work.', image: disciplineGenomics, alt: 'Fluorescence microscopy image from chromosome research' },
  { label: 'Bioinformatics', focus: 'Bioinformatics and computational biology', description: 'Computational biology, biological data science, and analysis.', image: disciplineDataScience, alt: 'Published single-cell sequencing maps and data visualizations', imageClass: 'pathway-data' },
  { label: 'Bioprocess & manufacturing', focus: 'Bioprocess and manufacturing science', description: 'Process development, manufacturing science, and quality.', image: disciplineBioprocess, alt: 'Cell-culture bioreactors in a laboratory' },
  { label: 'Protein science & drug discovery', focus: 'Protein science and drug discovery', description: 'Protein engineering, assays, and therapeutic discovery.', image: disciplineProtein, alt: 'Protein crystals viewed through a microscope', imageClass: 'pathway-protein' },
  { label: 'Immunology & infectious disease', focus: 'Immunology and infectious disease', description: 'Immune biology, host-pathogen research, and vaccines.', image: disciplineImmunology, alt: 'Toxoplasma parasites inside a fibroblast host cell' },
] as const;

function FeaturedCompany({ name }: { name: string }) {
  const logo = companyLogoAsset(name);
  return (
    <span className={`featured-company${logo ? ` has-logo logo-${logo.fit}` : ' is-wordmark'}`}>
      {logo
        ? <Image src={logo.src} alt={`${name} logo`} width={180} height={64} />
        : <span>{name}</span>}
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
  const studentRoles = all.filter((opportunity) => (
    ['undergraduate', 'graduate', 'mixed'].includes(opportunity.audience_bucket)
  ));
  const companies = new Set(studentRoles.map((opportunity) => opportunity.company_name)).size;
  const focusAreas = new Set(studentRoles.flatMap((opportunity) => opportunity.scientific_lanes ?? [])).size;
  const featured = studentRoles.slice(0, 4);

  return (
    <div className="home-editorial">
      <section className="editorial-hero site-wrap">
        <div className="editorial-hero-copy">
          <p className="home-attribution">Curated and reviewed by the CSULB Biotechnology Club</p>
          <h1>Opportunities for what comes next.</h1>
          <p className="editorial-intro">
            Biotechnology begins with the urge to look closer. Find internships,
            research, and early-career work that can turn that curiosity into practice.
          </p>
          <div className="editorial-actions">
            <Link href="/internships" className="primary-button">Browse opportunities <span aria-hidden="true">→</span></Link>
            <Link href="/calendar" className="secondary-button">View deadlines</Link>
          </div>
        </div>

        <figure className="science-collage">
          <div className="science-orbit science-orbit-one" aria-hidden="true" />
          <div className="science-orbit science-orbit-two" aria-hidden="true" />
          <div className="science-image">
            <Image
              src={heroEpithelialCells}
              alt="Cultured epithelial cells with Golgi in yellow-green, actin in magenta, and DNA in cyan"
              fill
              preload
              placeholder="blur"
              sizes="(max-width: 760px) 82vw, 42vw"
            />
          </div>
        </figure>
      </section>

      <section className="trust-ledger" aria-label="Current opportunity board counts">
        <div className="site-wrap trust-ledger-inner">
          <div className="trust-metrics" aria-label="Current board counts">
            <div><strong>{studentRoles.length}</strong><span>open roles</span></div>
            <div><strong>{companies}</strong><span>employers</span></div>
            <div><strong>{focusAreas}</strong><span>focus areas</span></div>
          </div>
        </div>
      </section>

      <section className="featured-ledger site-wrap" aria-labelledby="featured-title">
        <header className="editorial-section-label">
          <h2 id="featured-title">Current opportunities</h2>
          <Link href="/internships">View all opportunities <span aria-hidden="true">→</span></Link>
        </header>

        {featured.length > 0 ? (
          <ol className="featured-list">
            {featured.map((opportunity) => (
              <li key={opportunity.id}>
                <a
                  href={opportunity.posting_url ?? '/internships'}
                  target={opportunity.posting_url ? '_blank' : undefined}
                  rel={opportunity.posting_url ? 'noopener noreferrer nofollow' : undefined}
                >
                  <FeaturedCompany name={opportunity.company_name} />
                  <span className="featured-role">
                    <strong>{opportunity.title}</strong>
                    <small>{opportunityDetails(opportunity)}</small>
                  </span>
                  <time>{opportunity.deadline ? `Apply by ${formatDate(opportunity.deadline)}` : 'No fixed deadline stated'}</time>
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
              src={missionHistology}
              alt="Histology of basal-like breast cancer tissue"
              fill
              placeholder="blur"
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
              <Link href="/about">How the board is maintained <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>

      <section className="biotech-pathways site-wrap" aria-labelledby="pathways-title">
        <header>
          <div>
            <h2 id="pathways-title">See where the science can take you.</h2>
            <p>Explore the questions, tools, and environments behind each field, then see where you might fit.</p>
          </div>
          <Link href="/internships">Explore every opportunity <span aria-hidden="true">→</span></Link>
        </header>
        <div className="biotech-pathway-grid">
          {DISCIPLINES.map((discipline) => (
            <Link
              key={discipline.focus}
              href={`/internships?focus=${encodeURIComponent(discipline.focus)}`}
              className="biotech-pathway"
            >
              <Image
                className={'imageClass' in discipline ? discipline.imageClass : undefined}
                src={discipline.image}
                alt={discipline.alt}
                fill
                placeholder="blur"
                sizes="(max-width: 700px) 100vw, 33vw"
              />
              <span className="biotech-pathway-copy">
                <span>
                  <strong>{discipline.label}</strong>
                  <small>{discipline.description}</small>
                </span>
                <b aria-hidden="true">→</b>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-zebrafish-coda" aria-labelledby="zebrafish-title">
        <div className="home-zebrafish-media">
          <Image
            src={zebrafishVasculature}
            alt="Fluorescently labeled blood vessels in a developing zebrafish embryo"
            fill
            placeholder="blur"
            sizes="100vw"
          />
          <div className="home-zebrafish-copy">
            <h2 id="zebrafish-title">Find the work that draws you in.</h2>
            <Link href="/internships">Explore current opportunities <span aria-hidden="true">→</span></Link>
          </div>
        </div>
        <div className="home-zebrafish-accent" aria-hidden="true" />
      </section>
    </div>
  );
}
