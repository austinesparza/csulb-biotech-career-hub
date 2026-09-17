import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import aboutDnaAnalysts from '../../../public/brand/about-dna-analysts.webp';
import aboutHela from '../../../public/brand/about-hela.webp';
import footerLab from '../../../public/brand/footer-lab.webp';

const DISCOVERY_PATHS = [
  ['Daily source checks', 'Approved employer and program sites'],
  ['Broader discovery', 'Search results, older listings, and student tips'],
] as const;

export default function AboutPage() {
  return (
    <div className="about-page about-page-reduced">
      <header className="about-hero site-wrap">
        <div>
          <h1>How the Career Hub works.</h1>
        </div>
        <figure>
          <Image
            src={aboutHela}
            alt="Living HeLa cells with nuclei, microtubules, and mitochondria shown in blue, green, and red"
            fill
            preload
            placeholder="blur"
            sizes="(max-width: 820px) 100vw, 44vw"
          />
        </figure>
      </header>

      <section className="about-maintainers site-wrap" aria-labelledby="maintainers-title">
        <h2 id="maintainers-title">Who maintains the Career Hub</h2>
        <div>
          <p>
            Club members look for roles on employer career sites and program pages, then
            record the eligibility, dates, location, pay, and science described there.
            Another student checks the entry before it reaches the public board.
          </p>
          <p>
            This is an independent club resource, not an official CSULB job board.
            Inclusion does not mean the university or the club endorses an employer.
          </p>
        </div>
      </section>

      <section className="about-system" aria-labelledby="system-title">
        <div className="site-wrap">
          <header>
            <p className="about-system-kicker">From search to review</p>
            <h2 id="system-title">How a lead becomes a public listing.</h2>
          </header>
          <div
            className="about-workflow"
            role="img"
            aria-label="Daily source checks and broader discovery feed student review. Reviewed leads are either published to the public board or kept in the archive. The archive helps guide the next search."
          >
            <div className="about-workflow-group about-workflow-sources">
              <span className="about-workflow-label">Find leads</span>
              {DISCOVERY_PATHS.map(([title, body]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <span className="about-workflow-arrow" aria-hidden="true">→</span>
            <article className="about-workflow-review">
              <span className="about-workflow-label">Check the source</span>
              <h3>Student review</h3>
              <p>Confirm the deadline, eligibility, pay, location, and scientific focus.</p>
            </article>
            <span className="about-workflow-arrow" aria-hidden="true">→</span>
            <div className="about-workflow-group about-workflow-outcomes">
              <span className="about-workflow-label">Decide</span>
              <article className="is-public">
                <h3>Public board</h3>
                <p>Current listing and employer source</p>
              </article>
              <article className="is-archive">
                <h3>Archive</h3>
                <p>Past, changed, or rejected records</p>
              </article>
            </div>
          </div>
          <div className="about-workflow-loop">
            <span aria-hidden="true">↺</span>
            <p><strong>The archive supports the next search.</strong> Timing patterns and recurring employers feed back into discovery.</p>
          </div>
        </div>
      </section>

      <section className="about-before-apply site-wrap" aria-labelledby="before-apply-title">
        <h2 id="before-apply-title">Before you apply</h2>
        <div>
          <p>
            Use the hub to compare openings and understand the basics. Then open the
            attached employer page and confirm the deadline, eligibility, pay, and
            application instructions for yourself.
          </p>
          <p>
            Earlier listings stay in the archive. They can show when a program tends to
            recruit, but they are never presented as current openings.
          </p>
          <Link href="/internships">Browse current opportunities <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="about-memory site-wrap" aria-labelledby="memory-title">
        <div className="about-memory-visual">
          <Image
            src={footerLab}
            alt="A researcher pipetting samples at a laboratory bench while colleagues work nearby"
            fill
            placeholder="blur"
            sizes="(max-width: 820px) 100vw, 58vw"
          />
        </div>
        <div className="about-memory-copy">
          <p className="about-memory-kicker">The archive</p>
          <h2 id="memory-title">Past searches give students a head start.</h2>
          <p>
            Last year&apos;s listings show when recurring programs tend to open and which
            employers are worth checking again. That can give the next group of students
            more time to prepare.
          </p>
          <p>
            The archive is a lead, not proof that a role is open. Current status and
            eligibility always come from the employer&apos;s live page.
          </p>
        </div>
      </section>

      <section className="about-contribute site-wrap">
        <div className="about-contribute-image">
          <Image
            src={aboutDnaAnalysts}
            alt="Three DNA analysts preparing samples at a sequencing laboratory bench"
            fill
            placeholder="blur"
            sizes="(max-width: 820px) 100vw, 60vw"
          />
        </div>
        <div className="about-contribute-copy">
          <h2>Help us keep the board useful.</h2>
          <p>Found a role we missed, a changed deadline, or a broken link? Send it to the club with the employer source.</p>
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
