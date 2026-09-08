import Link from 'next/link';

const CHECKS = [
  ['Degree level', 'Look for language that names master’s students, graduate students, or your exact degree level.'],
  ['Current enrollment', 'Note whether the role requires full-time, half-time, or simply current enrollment.'],
  ['Return to school', 'Some programs require at least one academic term after the internship ends.'],
  ['Graduation window', 'Compare your expected conferral date with the published range, not just the year.'],
  ['Program and institution', 'Confirm your field is accepted and check for U.S., state, or partner-school restrictions.'],
  ['Work authorization', 'Read sponsorship, CPT or OPT, citizenship, and permanent-authorization language literally.'],
  ['Dates and location', 'Make sure you can meet the full schedule, on-site expectations, travel, and relocation terms.'],
  ['Application materials', 'Gather transcripts, references, and work samples before you begin the application.'],
] as const;

export default function EligibilityPage() {
  return (
    <div className="site-wrap">
      <header className="page-head">
        <h1>Eligibility</h1>
        <p className="lede">
          Each internship sets its own degree, enrollment, graduation, and work
          authorization requirements. Check them before you apply.
        </p>
      </header>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Who this is for</h2>
        </div>
        <p style={{ fontFamily: 'var(--serif)', fontSize: '1.45rem', lineHeight: 1.42, maxWidth: '46ch' }}>
          Every opportunity on the public board is a graduate internship or explicitly
          accepts graduate students. Some accept MSc students at any stage. Others require
          a completed first year, a specific graduation window, or continued enrollment.
        </p>
      </section>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Start with the fine print</h2>
        </div>
        <ol className="checks-grid">
          {CHECKS.map(([title, body], index) => (
            <li className="check-item" key={title}>
              <span className="check-number">{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{title}</strong><p>{body}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <div className="notice" style={{ marginBottom: 64 }}>
        <span aria-hidden="true">i</span>
        <span>Do not enter GPA, citizenship, work authorization, transcript information, or application history into a shared browser profile. <Link href="/privacy">Read the privacy policy.</Link></span>
      </div>
    </div>
  );
}
