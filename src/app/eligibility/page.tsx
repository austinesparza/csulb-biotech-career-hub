import Image from 'next/image';
import Link from 'next/link';

const SIGNALS = [
  ['Real work', 'A question, process, or product the team genuinely needs.'],
  ['Real teaching', 'Someone who makes time to show you how the work is done and judged.'],
  ['A new capability', 'A method or way of thinking you can use long after the role ends.'],
  ['Room to participate', 'Pay, timing, location, and support that make the experience possible.'],
] as const;

const CHECKS = [
  ['The work', 'What will you own, practice, or produce?'],
  ['The people', 'Who will teach you, and how often will you work together?'],
  ['The learning', 'Which methods, systems, or decisions will become familiar?'],
  ['The access', 'Do your degree stage, enrollment, and work authorization fit?'],
  ['The reality', 'Do pay, location, schedule, and relocation make the role possible?'],
  ['The evidence', 'Does the live employer posting support every important claim?'],
] as const;

const RESOURCES = [
  {
    title: 'Search funded research programs',
    href: 'https://www.pathwaystoscience.org/',
    image: '/brand/discipline-neuroscience.webp',
    alt: 'Green fluorescent neurons branching across a dark field',
    source: 'Pathways to Science',
    status: 'Live directory',
    note: 'Search current undergraduate and graduate programs. Confirm the year on each host page.',
  },
  {
    title: 'Find NSF research experiences',
    href: 'https://etap.nsf.gov/',
    image: '/brand/mission-histology.webp',
    alt: 'A breast cancer tissue section used in biomedical research',
    source: 'National Science Foundation',
    status: 'Live federal directory',
    note: 'Browse NSF research experiences. The individual program page controls current dates and eligibility.',
  },
  {
    title: 'Prepare an application for science',
    href: 'https://www.training.nih.gov/pdf/online-career-resources-guides/',
    image: '/brand/footer-lab.webp',
    alt: 'Scientists working together at a laboratory bench',
    source: 'NIH OITE',
    status: 'Current guidance',
    note: 'Practical guides for resumes, CVs, cover letters, interviews, and informational conversations.',
  },
  {
    title: 'Talk through your next move',
    href: 'https://www.csulb.edu/career-development-center/students/career-counseling-appointments',
    image: '/brand/discipline-bioprocess.webp',
    alt: 'Cell-culture bioreactors in a laboratory',
    source: 'CSULB Career Development Center',
    status: 'Current campus service',
    note: 'Book a conversation about a search, application, interview, offer, or change in direction.',
  },
  {
    title: 'Study a past internship cycle',
    href: 'https://www.csulbbiotech.com/post/2024-2025-internship-repository',
    image: '/brand/discipline-data-science.webp',
    alt: 'Single-cell sequencing maps used to compare biological populations',
    source: 'CSULB Biotechnology Club',
    status: 'Past-cycle reference',
    note: 'Use these older roles to learn which employers and program types recur. Do not assume a listing is open now.',
  },
] as const;

export default function PreparationPage() {
  return (
    <div className="prepare-page">
      <header className="prepare-hero site-wrap">
        <div className="prepare-hero-copy">
          <h1>An internship should change what you can do.</h1>
          <p>
            Look past the title. The right role gives you a real problem, someone who
            will teach you, and enough support to do the work well.
          </p>
        </div>
        <div className="prepare-hero-image">
          <Image
            src="/brand/prepare-students.webp"
            alt="Biotechnology students working together at a laboratory bench"
            fill
            preload
            sizes="(max-width: 820px) 100vw, 48vw"
          />
        </div>
      </header>

      <section className="prepare-signals" aria-labelledby="signals-title">
        <div className="site-wrap">
          <h2 id="signals-title">What makes the experience worth your time.</h2>
          <div className="prepare-signal-grid">
            {SIGNALS.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="prepare-choice site-wrap" aria-labelledby="choice-title">
        <div className="prepare-choice-image">
          <Image
            src="/brand/mission-histology.webp"
            alt="Histology of basal-like breast cancer tissue"
            fill
            sizes="(max-width: 820px) 100vw, 42vw"
          />
        </div>
        <div className="prepare-choice-copy">
          <h2 id="choice-title">Read the work, not the brand.</h2>
          <div className="prepare-check-grid">
            {CHECKS.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="trusted-resources site-wrap" aria-labelledby="resources-title">
        <header>
          <h2 id="resources-title">Useful places to begin.</h2>
          <p>Current program directories, practical application help, and one clearly labeled record of an earlier search cycle.</p>
        </header>
        <div className="resource-grid">
          {RESOURCES.map((resource) => (
            <a key={resource.href} href={resource.href} target="_blank" rel="noreferrer">
              <div className="resource-image">
                <Image src={resource.image} alt={resource.alt} fill sizes="(max-width: 640px) 100vw, 25vw" />
              </div>
              <div className="resource-copy">
                <span className="resource-status">{resource.status}</span>
                <h3>{resource.title}</h3>
                <p>{resource.note}</p>
                <span>{resource.source} <b aria-hidden="true">↗</b></span>
              </div>
            </a>
          ))}
        </div>
      </section>

      <div className="notice prepare-privacy site-wrap">
        <span aria-hidden="true">i</span>
        <span>Do not enter GPA, citizenship, work authorization, transcript information, or application history into a shared browser profile. <Link href="/privacy">Read the privacy policy.</Link></span>
      </div>
    </div>
  );
}
