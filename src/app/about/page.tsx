import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

const SYSTEM_STEPS = [
  ['Look in more places', 'Employer feeds, program pages, past club records, and student leads widen the search.'],
  ['Save the evidence', 'Dates, degree language, pay, methods, and location stay connected to the source text.'],
  ['Flag what is uncertain', 'A missing date or changed requirement becomes review work. It does not become a guess.'],
  ['Check before publishing', 'A role reaches the board only after its employer page and important claims have been reviewed.'],
] as const;

const SYSTEM_MEMORY = [
  ['Preserve the season', 'Employer, role family, month first seen, audience, deadline language, and review outcome become a record we can study.'],
  ['Learn what repeats', 'Earlier cycles help us decide when to search, which programs tend to return, and what deserves another look.'],
  ['Measure the model', 'Predictions are tested against later seasons. A current employer source still decides what is open and who can apply.'],
] as const;

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-hero site-wrap">
        <div>
          <h1>Talent is everywhere. Access is not.</h1>
          <p>
            Biotech roles are scattered across career sites, short recruiting windows,
            and programs students may never hear about. The Career Hub searches more
            widely, shows its evidence, and preserves what each class learns for the next.
          </p>
        </div>
        <figure>
          <Image
            src="/brand/about-hela.webp"
            alt="Living HeLa cells with nuclei, microtubules, and mitochondria shown in blue, green, and red"
            fill
            preload
            sizes="(max-width: 820px) 100vw, 44vw"
          />
        </figure>
      </header>

      <section className="about-system" aria-labelledby="system-title">
        <div className="site-wrap">
          <header>
            <h2 id="system-title">A search students can inspect.</h2>
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
            src="/brand/discipline-data-science.webp"
            alt="Published single-cell sequencing maps used to compare biological populations"
            fill
            sizes="(max-width: 820px) 100vw, 40vw"
          />
        </div>
        <div className="about-memory-copy">
          <h2 id="memory-title">Learning from our past.</h2>
          {SYSTEM_MEMORY.map(([title, body]) => (
            <article key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="about-tools">
        <div className="site-wrap about-tools-grid">
          <div>
            <h2>More reach without less care.</h2>
            <p>
              Automation helps a small student team watch many more employers. Evidence,
              review, and an archive keep that scale accountable. The goal is simple:
              fewer opportunities lost because a student lacked time, a connection, or
              advance knowledge of the recruiting season.
            </p>
          </div>
          <div className="about-tool-list" aria-label="Career Hub capabilities">
            <span>Official ATS and employer feeds</span>
            <span>Immutable source observations</span>
            <span>Field-level evidence</span>
            <span>Degree and enrollment checks</span>
            <span>Deadline conflict detection</span>
            <span>Duplicate and repost matching</span>
            <span>Human publication gates</span>
            <span>Audited, reversible corrections</span>
          </div>
        </div>
      </section>

      <section className="about-contribute site-wrap">
        <div className="about-contribute-image">
          <Image
            src="/brand/discipline-immunology.webp"
            alt="Fluorescence microscopy of parasites inside human fibroblast cells"
            fill
            sizes="(max-width: 820px) 100vw, 52vw"
          />
        </div>
        <div className="about-contribute-copy">
          <h2>What one student notices can open a door for many.</h2>
          <p>Send a new role, a changed deadline, a broken link, or evidence that our record needs correction.</p>
          <div className="about-actions">
            <Link href="/submit" className="primary-button">Submit a role or correction</Link>
            <a href={mailto(CLUB_LINKS.emailSubjectReport)} className="secondary-button">Email the club</a>
          </div>
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
