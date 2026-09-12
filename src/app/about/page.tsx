import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

const SYSTEM_STEPS = [
  ['Official listings first', 'We watch employer career feeds and program pages. Student leads can widen the search, but the employer page is where verification begins.'],
  ['Important fields, with evidence', 'The system pulls the requisition, dates, degree language, pay, methods, and location. It keeps the source text behind those fields.'],
  ['Same role or a look-alike?', 'Exact job IDs and links can match automatically. Similar titles stay separate until an officer decides whether they are duplicates, reposts, or different jobs.'],
  ['An officer publishes', 'A club officer checks the current page and the extracted evidence. A role reaches the public board only after that review.'],
] as const;

const SYSTEM_MEMORY = [
  ['Dates have a basis', 'We separate a deadline stated by the employer from a window inferred from an older recruiting cycle.'],
  ['Changes create review work', 'A changed requirement, new deadline, or missing page comes back to the queue instead of silently rewriting the public record.'],
  ['Corrections keep their history', 'Approved edits and removals are logged and reversible. Old cycles remain available for research without appearing as current openings.'],
] as const;

export default function AboutPage() {
  return (
    <div className="about-page">
      <header className="about-hero site-wrap">
        <div>
          <h1>Good opportunities should not depend on good luck.</h1>
          <p>
            Biotech recruiting favors students who already know where to look, when to
            look, and how to read a posting. That knowledge is not shared evenly. The
            Career Hub gathers the evidence, checks the details, and makes the search
            easier to enter.
          </p>
        </div>
        <figure>
          <Image
            src="/brand/discipline-data-science.webp"
            alt="Published single-cell sequencing maps and data visualizations"
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
            <p>The system can search widely. Publication stays narrow, documented, and human.</p>
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
          <h2 id="memory-title">A posting changes. Its evidence should not disappear.</h2>
          {SYSTEM_MEMORY.map(([title, body]) => (
            <article key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="about-tools">
        <div className="site-wrap about-tools-grid">
          <div>
            <h2>The work behind the board.</h2>
            <p>
              The board is backed by official feed connectors, immutable source
              observations, field-level evidence, deadline checks, record matching,
              and a private officer queue. We built that machinery for a practical
              reason. A student with less free time or a smaller professional network
              should not receive worse information.
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
