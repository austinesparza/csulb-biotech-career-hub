import Link from 'next/link';

const CHECKS = [
  ['Degree level', 'Does the posting explicitly accept master’s or graduate students?'],
  ['Enrollment', 'Must you be enrolled now, full time, or returning after the role?'],
  ['Graduation date', 'Does your expected graduation fall inside the published window?'],
  ['Academic field', 'Is your program named, closely related, or excluded?'],
  ['Work authorization', 'Is present or future sponsorship excluded?'],
  ['Location', 'Can you meet on-site, relocation, or state residency requirements?'],
  ['Schedule', 'Can you meet the dates, hours, and academic-term commitment?'],
  ['Materials', 'Are transcript, references, portfolio, or specific documents required?'],
] as const;

export default function EligibilityPage() {
  return (
    <div className="site-wrap">
      <header className="page-head">
        <p className="eyebrow">Hard-gate audit</p>
        <h1>Check the gates before you tailor a single sentence.</h1>
        <p className="lede">
          A strong scientific match is irrelevant if one published requirement makes you
          ineligible. Resolve these checks first, then invest in application materials.
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
          <h2>Eight checks</h2>
          <p>Answer each from the live posting or with one direct question to recruiting.</p>
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
