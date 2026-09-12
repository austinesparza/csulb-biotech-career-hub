import Image from 'next/image';
import Link from 'next/link';

const SIGNALS = [
  ['A problem to solve', 'The team can name the question, process, or product your work will move forward.'],
  ['Work you can own', 'You make something the team can use, evaluate, or build on.'],
  ['People who invest', 'You get context, feedback, and access to how decisions are made.'],
  ['A path forward', 'Strong work can lead to a return offer, a referral, or a clearer next role.'],
] as const;

const CHECKS = [
  ['The project', 'What problem will you help solve?'],
  ['The ownership', 'What will be yours to run, build, analyze, or deliver?'],
  ['The skills', 'Which methods, systems, and decisions will you practice?'],
  ['The mentorship', 'Who will review your work, and how often?'],
  ['The practical fit', 'Do the pay, timing, location, and requirements work for you?'],
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
          <h1>The right internship can launch your career.</h1>
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
          <div className="prepare-signals-intro">
            <h2 id="signals-title">You are there to move the work forward.</h2>
            <p>
              Teams hire interns because there is a real problem to solve. The work also
              gives you a chance to show how you think, contribute, and grow into what
              comes next.
            </p>
          </div>
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
          <h2 id="choice-title">Choose the project before the logo.</h2>
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
