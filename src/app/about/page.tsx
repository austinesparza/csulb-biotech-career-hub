import Image from 'next/image';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import aboutHela from '../../../public/brand/about-hela.webp';
import footerLab from '../../../public/brand/footer-lab.webp';
import prepareStudents from '../../../public/brand/prepare-students.webp';

const REVIEW_STEPS = [
  ['1', 'Find a lead', 'Employer sites, program pages, and student tips'],
  ['2', 'Open the source', 'The employer\'s current posting'],
  ['3', 'Student review', 'Dates, eligibility, pay, location, and scientific focus'],
  ['4', 'Publish', 'The reviewed listing and its source appear together'],
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
            <p className="about-system-kicker">From lead to listing</p>
            <h2 id="system-title">From employer source to public board.</h2>
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
          <div className="about-system-archive" aria-label="How archived listings support future searches">
            <span>Past listings</span>
            <b aria-hidden="true">→</b>
            <strong>Archive</strong>
            <p>Helps time the next search. Never shown as a current opening.</p>
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
            src={prepareStudents}
            alt="Biotechnology students working together in a teaching laboratory"
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
