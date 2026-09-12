import Link from 'next/link';

const PURPOSES = [
  ['Explore', 'Test a field, work setting, or scientific discipline before making a longer commitment.'],
  ['Build', 'Turn coursework and research experience into evidence that you can contribute to a team.'],
  ['Learn', 'See how organizations plan experiments, manage data, make decisions, and communicate results.'],
  ['Connect', 'Develop relationships with mentors and colleagues who can expand how you understand the field.'],
] as const;

const ROADMAP = [
  ['Find', 'Search broadly enough to see the range of work, then save roles that genuinely fit your goals.'],
  ['Read', 'Use the full employer posting to verify responsibilities, requirements, dates, and location.'],
  ['Prepare', 'Match your resume and examples to the work. Gather transcripts or references before the deadline.'],
  ['Apply', 'Follow the employer’s instructions exactly and keep a record of what you submitted.'],
  ['Learn', 'Prepare for interviews, ask informed questions, and evaluate what the experience would teach you.'],
] as const;

const CHECKS = [
  ['Degree level', 'Does the posting accept your current degree level, field, and expected graduation date?'],
  ['Enrollment', 'Must you remain enrolled or return to school for another term after the internship?'],
  ['Work authorization', 'What does the employer state about citizenship, sponsorship, CPT, or OPT?'],
  ['Timing', 'Can you meet the application deadline and the full internship schedule?'],
  ['Location', 'Is the role on-site, hybrid, or remote, and can you manage travel or relocation?'],
  ['Actual work', 'Do the responsibilities provide the skills, exposure, or mentorship you want to develop?'],
  ['Compensation', 'Are pay, hours, housing, and relocation support clear enough to judge feasibility?'],
  ['Materials', 'Do you have the requested resume, cover letter, transcript, references, and work samples?'],
] as const;

const RESOURCES = [
  {
    title: 'Find jobs and internships',
    body: 'Use CSULB’s job-search framework and campus resources to build a structured search.',
    href: 'https://www.csulb.edu/career-development-center/students/job-internship-search',
  },
  {
    title: 'Write stronger application materials',
    body: 'Review CSULB guidance and samples for resumes, CVs, and cover letters.',
    href: 'https://www.csulb.edu/career-development-center/students/resumes-cover-letters',
  },
  {
    title: 'Prepare for interviews',
    body: 'Learn how to research the organization, practice responses, and plan your questions.',
    href: 'https://www.csulb.edu/career-development-center/students/interviewing',
  },
  {
    title: 'Talk with a career counselor',
    body: 'Schedule a CSULB Career Development Center appointment for individual support.',
    href: 'https://www.csulb.edu/career-development-center/students/career-counseling-appointments',
  },
] as const;

export default function PreparationPage() {
  return (
    <div className="site-wrap prepare-page">
      <header className="prepare-head">
        <p className="editorial-overline">Before you apply</p>
        <h1>Make the internship count.</h1>
        <p className="lede">
          A useful internship helps you test a direction, build evidence of your skills,
          and understand how scientific work happens beyond the classroom.
        </p>
      </header>

      <section className="prepare-purpose" aria-labelledby="purpose-title">
        <header>
          <p className="editorial-overline">The point of the experience</p>
          <h2 id="purpose-title">Use an internship to move from interest to evidence.</h2>
        </header>
        <div className="purpose-grid">
          {PURPOSES.map(([title, body]) => (
            <article key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="prepare-roadmap" aria-labelledby="roadmap-title">
        <header>
          <p className="editorial-overline">A practical sequence</p>
          <h2 id="roadmap-title">From discovery to decision</h2>
        </header>
        <ol>
          {ROADMAP.map(([title, body], index) => (
            <li key={title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div><h3>{title}</h3><p>{body}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section className="prepare-checks" aria-labelledby="checks-title">
        <header>
          <p className="editorial-overline">Before investing your time</p>
          <h2 id="checks-title">Read the posting critically.</h2>
          <p>Our summaries help you screen a role. The current employer posting remains the source of truth.</p>
        </header>
        <div className="prepare-check-grid">
          {CHECKS.map(([title, body]) => (
            <article key={title}><h3>{title}</h3><p>{body}</p></article>
          ))}
        </div>
      </section>

      <section className="trusted-resources" aria-labelledby="resources-title">
        <header>
          <p className="editorial-overline">Trusted support</p>
          <h2 id="resources-title">Use the resources you already have.</h2>
          <p>These links go directly to the CSULB Career Development Center.</p>
        </header>
        <div className="resource-grid">
          {RESOURCES.map((resource) => (
            <a key={resource.href} href={resource.href} target="_blank" rel="noreferrer">
              <h3>{resource.title}</h3>
              <p>{resource.body}</p>
              <span>Open CSULB resource <b aria-hidden="true">↗</b></span>
            </a>
          ))}
        </div>
      </section>

      <div className="prepare-next">
        <div><p className="editorial-overline">Ready to search?</p><h2>Start with roles that can teach you something worth carrying forward.</h2></div>
        <Link href="/internships" className="primary-button">Browse opportunities <span aria-hidden="true">→</span></Link>
      </div>

      <div className="notice prepare-privacy">
        <span aria-hidden="true">i</span>
        <span>Do not enter GPA, citizenship, work authorization, transcript information, or application history into a shared browser profile. <Link href="/privacy">Read the privacy policy.</Link></span>
      </div>
    </div>
  );
}
