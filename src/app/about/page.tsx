import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

const REVIEW_STEPS = [
  ['1', 'Find the role', 'Employer sites, program pages, earlier club records, and student leads help widen the search.'],
  ['2', 'Check the source', 'A club reviewer confirms the employer page and records the eligibility, timing, location, pay, and scientific focus it actually states.'],
  ['3', 'Publish what is known', 'The role reaches the public board with its source attached. Missing or conflicting details remain clearly labeled.'],
] as const;

const STUDENT_PROMISES = [
  ['The source stays visible', 'Every current role links to the posting students should verify before applying.'],
  ['Uncertainty is not filled with a guess', 'If a deadline, pay range, or eligibility rule is missing, the board says that directly.'],
  ['Past listings remain separate', 'Earlier cycles help students anticipate recruiting seasons, but they are never presented as current openings.'],
] as const;

const SEARCH_MEMORY = [
  ['Recruiting has a rhythm', 'Earlier listings show when recurring programs usually appear, so students can prepare before a short window opens.'],
  ['Patterns still need a current source', 'The archive helps the club know where to look. The employer page still decides whether a role is open and who can apply.'],
  ['One class helps the next', 'A clean record lets future students begin with more context, more time, and fewer closed doors.'],
] as const;

export default function AboutPage() {
  return (
    <div className="about-page about-page-reduced">
      <header className="about-hero site-wrap">
        <div>
          <h1>A student-run search with the source attached.</h1>
          <p>
            The CSULB Biotechnology Club maintains this hub so students can find
            opportunities earlier, understand who can apply, and verify every important
            detail at the employer&apos;s current posting.
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
          <figcaption>Fluorescence microscopy of living HeLa cells.</figcaption>
        </figure>
      </header>

      <section className="about-maintainers site-wrap" aria-labelledby="maintainers-title">
        <h2 id="maintainers-title">Who maintains the Career Hub</h2>
        <div>
          <p>
            Club members collect possible roles, compare them with the employer source,
            and review the information students need to make a decision. Automation helps
            the team notice more leads. A student reviewer still decides what is published.
          </p>
          <p>
            The board is an independent club resource. It is not an official CSULB job
            board, and inclusion is not an endorsement by the university or the club.
          </p>
        </div>
      </section>

      <section className="about-system" aria-labelledby="system-title">
        <div className="site-wrap">
          <header>
            <h2 id="system-title">How a role reaches the board</h2>
          </header>
          <ol className="about-system-grid">
            {REVIEW_STEPS.map(([number, title, body]) => (
              <li key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="about-promises site-wrap" aria-labelledby="promises-title">
        <h2 id="promises-title">What students can expect</h2>
        <div>
          {STUDENT_PROMISES.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
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
          {SEARCH_MEMORY.map(([title, body]) => (
            <article key={title}>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-tools">
        <div className="site-wrap about-tools-grid">
          <div>
            <h2>More reach without less care.</h2>
            <p>
              Simple tools help a small student team notice more opportunities. Sources,
              clear uncertainty, and student review keep that wider search accountable.
            </p>
          </div>
          <div className="about-tool-list" aria-label="How the Career Hub stays useful">
            <span>Watch employer sites</span>
            <span>Keep source links</span>
            <span>Flag changed details</span>
            <span>Require student review</span>
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
          <p>Send a new role, a changed deadline, a broken link, or evidence that a listing needs correction.</p>
          <div className="about-actions">
            <Link href="/submit" className="primary-button">Submit a role or correction</Link>
            <a href={mailto(CLUB_LINKS.emailSubjectReport)} className="secondary-button">Email the club</a>
          </div>
        </div>
      </section>

      <p className="about-disclaimer site-wrap">
        Always confirm deadlines, eligibility, compensation, and application instructions
        in the employer&apos;s current posting before you apply.
      </p>
    </div>
  );
}
