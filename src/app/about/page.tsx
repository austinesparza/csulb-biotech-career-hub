import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

const SYSTEM_STEPS = [
  ['Discover', 'Official career feeds, employer pages, past programs, and student leads widen the search.'],
  ['Extract', 'Structured parsers and evidence-bound extraction recover dates, audience rules, methods, and application details.'],
  ['Verify', 'Deterministic checks flag conflicts, duplicates, missing evidence, and expired deadlines for officer review.'],
  ['Publish', 'Only authenticated approval moves a public-safe record onto the board. Source history remains attached.'],
] as const;

const SYSTEM_MEMORY = [
  ['Source snapshots', 'The page that supported a claim is archived privately so later changes can be explained.'],
  ['Version history', 'Material changes create a new review task instead of silently rewriting an approved record.'],
  ['Recruiting signals', 'Past cycles shape watch windows and search priority. Sparse history is labeled as a clue, never a prediction.'],
] as const;

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-hero site-wrap">
        <div>
          <h1>A career board with an evidence trail.</h1>
          <p>
            Opportunities move quickly. The Career Hub combines broad discovery,
            careful source work, and human judgment so students can see not only
            what was found, but why it belongs here.
          </p>
        </div>
        <figure>
          <Image
            src="/brand/discipline-data-science.webp"
            alt="Single-cell sequencing maps and data visualizations"
            fill
            preload
            sizes="(max-width: 820px) 100vw, 44vw"
          />
        </figure>
      </header>

      <section className="about-system" aria-labelledby="system-title">
        <div className="site-wrap">
          <header>
            <h2 id="system-title">From a possible lead to a trusted listing.</h2>
            <p>Automation expands the field. Evidence and officer review control publication.</p>
          </header>
          <div className="about-system-grid">
            {SYSTEM_STEPS.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="about-memory site-wrap" aria-labelledby="memory-title">
        <div className="about-memory-visual">
          <Image
            src="/brand/discipline-single-cell.webp"
            alt="Fluorescence microscopy of NEAT1 paraspeckles in human cells"
            fill
            sizes="(max-width: 820px) 100vw, 40vw"
          />
        </div>
        <div className="about-memory-copy">
          <h2 id="memory-title">The system remembers what a list forgets.</h2>
          {SYSTEM_MEMORY.map(([title, body]) => (
            <article key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="about-tools">
        <div className="site-wrap about-tools-grid">
          <div>
            <h2>Built in public. Governed in private.</h2>
            <p>
              Next.js presents the public board. Supabase keeps normalized records,
              immutable source observations, review history, and access controls.
              Official ATS connectors and bounded web search create leads. Every
              publication decision remains human.
            </p>
          </div>
          <div className="about-tool-list" aria-label="Career Hub capabilities">
            <span>Official feed connectors</span>
            <span>Evidence-bound extraction</span>
            <span>Deadline conflict detection</span>
            <span>Audience classification</span>
            <span>Duplicate and repost matching</span>
            <span>Historical watch windows</span>
            <span>Officer review gates</span>
            <span>Reversible corrections</span>
          </div>
        </div>
      </section>

      <section className="about-contribute site-wrap">
        <div>
          <h2>Help us see what we missed.</h2>
          <p>Found a role, changed deadline, broken link, or eligibility issue? Send the evidence to the club.</p>
        </div>
        <div className="about-actions">
          <Link href="/submit" className="primary-button">Submit a role or correction</Link>
          <a href={mailto(CLUB_LINKS.emailSubjectReport)} className="secondary-button">Email the club</a>
        </div>
      </section>

      <p className="about-disclaimer site-wrap">
        Listings are provided for information. Inclusion is not an endorsement by the
        CSULB Biotechnology Club or California State University, Long Beach. Always
        confirm details in the employer&apos;s current posting.
      </p>
    </div>
  );
}
