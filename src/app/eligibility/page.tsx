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
        <p className="eyebrow">Before you apply</p>
        <h1>Read the eligibility section twice.</h1>
        <p className="lede">
          A role can be a great scientific fit and still be closed to you. Spend five
          minutes on the requirements before spending an hour on the application.
        </p>
      </header>

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>Graduate access standard</h2>
          <p>The rule behind the main board.</p>
        </div>
        <p style={{ fontFamily: 'var(--serif)', fontSize: '1.45rem', lineHeight: 1.42, maxWidth: '46ch' }}>
          Graduate-only and explicitly graduate-accessible roles belong on the main board.
          Mixed-level roles require explicit graduate eligibility. Adjacent exceptions are
          labeled and never represented as graduate roles.
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

      <section className="editorial-strip">
        <div className="margin-note">
          <h2>How buckets work</h2>
          <p>Existence and student eligibility are tracked separately.</p>
        </div>
        <div className="directory-grid">
          <div className="directory-row"><div><h2>Graduate-accessible</h2><p>Explicit graduate eligibility. Main board.</p></div><span className="pill pill-green">Main</span></div>
          <div className="directory-row"><div><h2>Adjacent</h2><p>Co-op, different term, or related format. Opt-in view.</p></div><span className="pill pill-gold">Separate</span></div>
          <div className="directory-row"><div><h2>Special eligibility</h2><p>Program-specific rules need careful review.</p></div><span className="pill pill-gold">Separate</span></div>
          <div className="directory-row"><div><h2>Ineligible for CSULB students</h2><p>Retained for officer monitoring and audit, excluded from public results.</p></div><span className="pill pill-red">Officer-only</span></div>
        </div>
      </section>

      <div className="notice" style={{ marginBottom: 64 }}>
        <span aria-hidden="true">i</span>
        <span>Do not enter GPA, citizenship, work authorization, transcript information, or application history into a shared browser profile. <Link href="/privacy">Read the privacy policy.</Link></span>
      </div>
    </div>
  );
}
