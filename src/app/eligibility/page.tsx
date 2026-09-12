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
    body: 'Build a search that reaches beyond the most visible employers.',
    href: 'https://www.csulb.edu/career-development-center/students/job-internship-search',
    image: '/brand/genomic-flow.webp',
    alt: 'Abstract genomic patterns emerging from a sequencing flow cell',
  },
  {
    title: 'Shape your materials',
    body: 'Make your resume and cover letter answer the work in front of you.',
    href: 'https://www.csulb.edu/career-development-center/students/resumes-cover-letters',
    image: '/brand/career-workbench.webp',
    alt: 'A student reviewing application materials in a biotechnology laboratory',
  },
  {
    title: 'Practice the conversation',
    body: 'Prepare to explain your decisions, not just list your techniques.',
    href: 'https://www.csulb.edu/career-development-center/students/interviewing',
    image: '/brand/cellular-field.webp',
    alt: 'Microscopy-inspired network of cells',
  },
  {
    title: 'Get another perspective',
    body: 'Bring your questions to a CSULB career counselor.',
    href: 'https://www.csulb.edu/career-development-center/students/career-counseling-appointments',
    image: '/brand/bioprocess-light.webp',
    alt: 'Precision work in a bright bioprocess laboratory',
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
            src="/brand/career-workbench.webp"
            alt="A biotechnology student reviewing application materials in a laboratory"
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
            src="/brand/tissue-field.webp"
            alt="Microscopy-inspired biological tissue"
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
                <p>{resource.body}</p>
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
