import Image from 'next/image';
import Link from 'next/link';
import disciplineBioprocess from '../../../public/brand/discipline-bioprocess.webp';
import disciplineDataScience from '../../../public/brand/discipline-data-science.webp';
import disciplineNeuroscience from '../../../public/brand/discipline-neuroscience.webp';
import footerLab from '../../../public/brand/footer-lab.webp';
import missionHistology from '../../../public/brand/mission-histology.webp';
import prepareStudents from '../../../public/brand/prepare-students.webp';

const APPLICATION_STEPS = [
  ['01', 'Check eligibility first', 'Confirm the required degree level, enrollment dates, location, work authorization language, and any GPA threshold at the employer source.'],
  ['02', 'Read the work, not only the title', 'Identify the methods, scientific question, team, and expected output. Save the exact language you will need to address.'],
  ['03', 'Tailor the application', 'Match your CV or resume to the role using evidence from your coursework, research, employment, and projects. Do not copy claims you cannot support.'],
  ['04', 'Get another review', 'Ask a mentor, peer, or career counselor to test whether your materials make the fit clear before the deadline.'],
] as const;

const ROLE_CHECKS = [
  ['Work you can own', 'Will you leave behind a result, workflow, analysis, or decision the team can use?'],
  ['Technical depth', 'Will you practice a method enough to become more independent with it?'],
  ['Useful mentorship', 'Will you receive context, feedback, and access to how decisions are made?'],
  ['A credible next step', 'Could the work strengthen a future application, referral, publication, or return offer?'],
] as const;

const RESOURCES = [
  {
    title: 'Search funded research programs',
    href: 'https://www.pathwaystoscience.org/',
    image: disciplineNeuroscience,
    alt: 'Green fluorescent neurons branching across a dark field',
    source: 'Pathways to Science',
    status: 'Live directory',
    note: 'Search current undergraduate and graduate programs. Confirm the year on each host page.',
  },
  {
    title: 'Find NSF research experiences',
    href: 'https://etap.nsf.gov/',
    image: missionHistology,
    alt: 'Breast cancer tissue sections used in biomedical research',
    source: 'National Science Foundation',
    status: 'Live federal directory',
    note: 'Browse NSF research experiences, then verify dates and eligibility on the individual program page.',
  },
  {
    title: 'Prepare an application for science',
    href: 'https://www.training.nih.gov/pdf/online-career-resources-guides/',
    image: footerLab,
    alt: 'A scientist pipetting samples at a laboratory bench',
    source: 'NIH OITE',
    status: 'Current guidance',
    note: 'Practical guidance for resumes, CVs, cover letters, interviews, and informational conversations.',
  },
  {
    title: 'Talk through your next move',
    href: 'https://www.csulb.edu/career-development-center/students/career-counseling-appointments',
    image: disciplineBioprocess,
    alt: 'Cell-culture bioreactors in a laboratory',
    source: 'CSULB Career Development Center',
    status: 'Current campus service',
    note: 'Book a conversation about a search, application, interview, offer, or change in direction.',
  },
  {
    title: 'Study a past internship cycle',
    href: 'https://www.csulbbiotech.com/post/2024-2025-internship-repository',
    image: disciplineDataScience,
    alt: 'Single-cell sequencing maps used to compare biological populations',
    source: 'CSULB Biotechnology Club',
    status: 'Past-cycle reference',
    note: 'Use earlier roles to recognize recurring employers and recruiting windows. Do not assume a listing is open now.',
  },
] as const;

export default function PreparationPage() {
  return (
    <div className="prepare-page prepare-page-reduced">
      <header className="prepare-hero site-wrap">
        <div className="prepare-hero-copy">
          <h1>Application help for science and biotech roles.</h1>
          <p>
            Start by confirming that you can apply. Then show, with evidence, how your
            experience connects to the work the team needs done.
          </p>
          <div className="prepare-hero-actions">
            <Link href="/internships" className="primary-button">Browse opportunities</Link>
            <a className="secondary-button" href="https://www.csulb.edu/career-development-center/students/career-counseling-appointments" target="_blank" rel="noreferrer">Campus career counseling ↗</a>
          </div>
        </div>
        <figure className="prepare-hero-image">
          <Image
            src={prepareStudents}
            alt="Biotechnology students working together at a laboratory bench"
            fill
            preload
            placeholder="blur"
            sizes="(max-width: 820px) 100vw, 48vw"
          />
          <figcaption>Students working together during a biotechnology laboratory course.</figcaption>
        </figure>
      </header>

      <section className="application-sequence" aria-labelledby="sequence-title">
        <div className="site-wrap">
          <header>
            <h2 id="sequence-title">A practical application sequence</h2>
          </header>
          <ol className="application-steps">
            {APPLICATION_STEPS.map(([number, title, body]) => (
              <li key={number}>
                <span>{number}</span>
                <div><h3>{title}</h3><p>{body}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="role-evaluation site-wrap" aria-labelledby="evaluation-title">
        <header>
          <h2 id="evaluation-title">Things to consider</h2>
        </header>
        <div className="role-evaluation-grid">
          {ROLE_CHECKS.map(([title, body]) => (
            <article key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="trusted-resources site-wrap" aria-labelledby="resources-title">
        <header>
          <h2 id="resources-title">Trusted starting points</h2>
          <p>Program directories, application guidance, and campus support. The linked source controls current details.</p>
        </header>
        <div className="resource-grid">
          {RESOURCES.map((resource) => (
            <a key={resource.href} href={resource.href} target="_blank" rel="noreferrer">
              <div className="resource-image">
                <Image
                  src={resource.image}
                  alt={resource.alt}
                  fill
                  placeholder="blur"
                  sizes="(max-width: 700px) 100vw, (max-width: 980px) 50vw, 33vw"
                />
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
