import Image from 'next/image';
import Link from 'next/link';

const SIGNALS = [
  ['Real work', 'A problem the team genuinely needs solved.'],
  ['Guidance', 'People who explain standards, context, and tradeoffs.'],
  ['Growth', 'Methods and judgment you can use again.'],
  ['Momentum', 'A clearer next move, even if your direction changes.'],
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
    title: 'Find internships',
    href: 'https://www.csulb.edu/career-development-center/students/job-internship-search',
    image: '/brand/discipline-genomics.webp',
    alt: 'Fluorescence microscopy image from chromosome research',
  },
  {
    title: 'Shape your materials',
    href: 'https://www.csulb.edu/career-development-center/students/resumes-cover-letters',
    image: '/brand/discipline-protein.webp',
    alt: 'Protein crystals viewed through a microscope',
  },
  {
    title: 'Practice the conversation',
    href: 'https://www.csulb.edu/career-development-center/students/interviewing',
    image: '/brand/discipline-neuroscience.webp',
    alt: 'Fluorescence microscopy of green fluorescent neurons',
  },
  {
    title: 'Get another perspective',
    href: 'https://www.csulb.edu/career-development-center/students/career-counseling-appointments',
    image: '/brand/discipline-bioprocess.webp',
    alt: 'Cell-culture bioreactors in a laboratory',
  },
] as const;

export default function PreparationPage() {
  return (
    <div className="prepare-page">
      <header className="prepare-hero site-wrap">
        <div className="prepare-hero-copy">
          <h1>Choose the work, not just the title.</h1>
          <p>
            The right internship gives you real problems, strong mentorship,
            and skills that change what you can do next.
          </p>
        </div>
        <div className="prepare-hero-image">
          <Image
            src="/brand/discipline-bioinformatics.webp"
            alt="Analysts working in a DNA identification laboratory"
            fill
            preload
            sizes="(max-width: 820px) 100vw, 48vw"
          />
        </div>
      </header>

      <section className="prepare-signals" aria-labelledby="signals-title">
        <div className="site-wrap">
          <h2 id="signals-title">What makes an internship worth your time?</h2>
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
          <h2 id="choice-title">Know what you are saying yes to.</h2>
          <div className="prepare-check-grid">
            {CHECKS.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="trusted-resources site-wrap" aria-labelledby="resources-title">
        <header>
          <h2 id="resources-title">Tools for the application in front of you.</h2>
          <p>Guidance from the CSULB Career Development Center.</p>
        </header>
        <div className="resource-grid">
          {RESOURCES.map((resource) => (
            <a key={resource.href} href={resource.href} target="_blank" rel="noreferrer">
              <div className="resource-image">
                <Image src={resource.image} alt={resource.alt} fill sizes="(max-width: 640px) 100vw, 25vw" />
              </div>
              <div className="resource-copy">
                <h3>{resource.title}</h3>
                <span>CSULB resource <b aria-hidden="true">↗</b></span>
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
