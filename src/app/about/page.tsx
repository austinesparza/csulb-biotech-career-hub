import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

const SYSTEM_STEPS = [
  ['Search beyond one network', 'Employer feeds, program pages, the club archive, and student leads widen the places we can look.'],
  ['Keep the source close', 'Dates, degree language, pay, methods, and location remain connected to the text that supports them.'],
  ['Treat uncertainty as information', 'A similar title, missing date, or changed requirement creates review work instead of a confident guess.'],
  ['Publish what we can defend', 'A role reaches the public board only after its current employer page and important claims have been checked.'],
] as const;

const SYSTEM_MEMORY = [
  ['Turn listings into labels', 'Employer, role family, month first seen, audience, deadline language, and review outcome become a structured learning record.'],
  ['Test the pattern', 'Past cycles can rank where we search and flag an unusual change. New cycles let us measure whether those signals were useful.'],
  ['Keep evidence in charge', 'A model may suggest where to look. Only a current source can establish that a role is open or that a student is eligible.'],
] as const;

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-hero site-wrap">
        <div>
          <h1>Good opportunities should not depend on good luck.</h1>
          <p>
            Biotech recruiting rewards time, networks, and knowledge that students do
            not receive equally. The Career Hub watches more places, makes the evidence
            easier to read, and carries what we learn from one class into the next.
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
            <h2 id="system-title">What happens before a role reaches the board.</h2>
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
            <h2>A wider search. A fairer starting point.</h2>
            <p>
              Automation gives a student search more reach. Evidence and review keep
              that reach accountable. Together, they reduce the advantage of having
              extra time, an inside contact, or prior knowledge of the recruiting cycle.
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
