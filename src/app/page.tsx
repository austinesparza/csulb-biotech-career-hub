import Image from 'next/image';
import Link from 'next/link';
import { companyLogoAsset } from '@/lib/companyLogos';
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
  { label: 'Cancer & oncology', focus: 'Cancer and oncology', description: 'Tumor biology, biomarkers, therapeutics, and translational research.' },
  { label: 'Genomics & genetics', focus: 'Genomics and genetics', description: 'Genome science, functional genetics, and variant-focused work.' },
  { label: 'Bioinformatics', focus: 'Bioinformatics and computational biology', description: 'Computational biology, biological data science, and analysis.' },
  { label: 'Bioprocess & manufacturing', focus: 'Bioprocess and manufacturing science', description: 'Process development, manufacturing science, and quality.' },
  { label: 'Protein science & drug discovery', focus: 'Protein science and drug discovery', description: 'Protein engineering, assays, and therapeutic discovery.' },
  { label: 'Immunology & infectious disease', focus: 'Immunology and infectious disease', description: 'Immune biology, host-pathogen research, and vaccines.' },
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
          <h1>Biotech internships and research opportunities for CSULB students.</h1>
          <p className="editorial-intro">
            Find current roles, compare eligibility and deadlines, and open the employer
            source before you apply.
          </p>
          <div className="editorial-actions">
            <Link href="/internships" className="primary-button">Browse opportunities <span aria-hidden="true">→</span></Link>
            <Link href="/calendar" className="secondary-button">View deadlines</Link>
          </div>
        </div>

        <figure className="science-collage">
          <div className="science-image">
            <Image
              src="/brand/hero-cells.webp"
              alt="Cultured epithelial cells with Golgi in yellow-green, actin in magenta, and DNA in cyan"
              fill
              preload
              sizes="(max-width: 760px) 82vw, 42vw"
            />
          </div>
          <figcaption>Fluorescence microscopy of cultured epithelial cells.</figcaption>
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

      <section className="home-club-note">
        <div className="site-wrap home-club-note-grid">
          <h2>Built for a search students can inspect.</h2>
          <div>
            <p>
              Club members collect roles from employer sites and program pages, check
              the important claims, and keep the source attached. If a deadline or
              eligibility rule is unclear, the board says so.
            </p>
            <Link href="/about">How the board is maintained <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <section className="biotech-pathways site-wrap" aria-labelledby="pathways-title">
        <header>
          <div>
            <h2 id="pathways-title">Browse by scientific focus</h2>
            <p>Start with the work you want to practice, then confirm the degree and enrollment requirements.</p>
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
              <span>
                <strong>{discipline.label}</strong>
                <small>{discipline.description}</small>
              </span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>

    </div>
  );
}
