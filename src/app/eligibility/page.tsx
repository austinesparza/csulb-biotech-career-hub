import Image from 'next/image';
import Link from 'next/link';

const SIGNALS = [
  ['A real problem', 'Work the team genuinely needs done.'],
  ['Someone who teaches', 'A manager or mentor who explains how good work is judged.'],
  ['Skills you can carry', 'Methods, tools, and decisions you will understand well enough to use again.'],
  ['A workable offer', 'Pay, timing, location, and support that make participation possible.'],
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
          <h1>Choose work that teaches you something.</h1>
          <p>
            The best internship is not always the biggest name. Look for real
            responsibility, close guidance, skills you can carry forward, and a path
            you can actually afford to take.
          </p>
        </div>
        <div className="prepare-hero-image">
          <Image
            src="/brand/discipline-diagnostics.webp"
            alt="Fluorescence microscopy panels used in molecular diagnostics research"
            fill
            preload
            sizes="(max-width: 820px) 100vw, 48vw"
          />
        </div>
      </header>

      <section className="prepare-signals" aria-labelledby="signals-title">
        <div className="site-wrap">
          <h2 id="signals-title">Before you apply, ask what you will leave with.</h2>
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
          <h2 id="choice-title">Look beneath the title.</h2>
          <div className="prepare-check-grid">
            {CHECKS.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="trusted-resources site-wrap" aria-labelledby="resources-title">
        <header>
          <h2 id="resources-title">Good places to start.</h2>
          <p>Current directories, practical guidance, and one clearly labeled record of an older search cycle.</p>
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
