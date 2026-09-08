import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import Link from 'next/link';

export default function AboutPage() {
  return (
    <div className="site-wrap">
      <header className="page-head">
        <h1>About</h1>
        <p className="lede">
          A student-maintained directory of graduate internships in biotechnology,
          genomics, cancer research, bioinformatics, and related fields.
        </p>
      </header>

      <section className="editorial-strip">
        <div className="margin-note"><h2>Built for graduate students</h2></div>
        <div className="about-copy">
          <p>
            The main board is reserved for roles that explicitly accept graduate students.
            Other records stay in the internal review system and do not crowd the public results.
          </p>
          <p>
            The goal is simple: help students find credible opportunities early enough to
            prepare a strong application.
          </p>
        </div>
      </section>

      <section className="editorial-strip">
        <div className="margin-note"><h2>How it works</h2></div>
        <div className="directory-grid">
          <div className="directory-row"><div><h2>Find</h2><p>Automation and student submissions surface possible roles.</p></div><span>01</span></div>
          <div className="directory-row"><div><h2>Review</h2><p>An officer checks the source, status, dates, and graduate eligibility.</p></div><span>02</span></div>
          <div className="directory-row"><div><h2>Publish</h2><p>Only approved, public-safe records appear on the site.</p></div><span>03</span></div>
          <div className="directory-row"><div><h2>Recheck</h2><p>Changes return to the review queue before the public record is updated.</p></div><span>04</span></div>
        </div>
      </section>

      <section className="editorial-strip">
        <div className="margin-note"><h2>Contribute</h2></div>
        <div className="about-copy">
          <p>Found a role, broken link, changed deadline, or eligibility issue? Send it to the club for review.</p>
          <div className="about-actions">
            <Link href="/submit" className="primary-button">Submit a role or correction</Link>
            <a href={mailto(CLUB_LINKS.emailSubjectReport)} className="secondary-button">Email the club</a>
          </div>
        </div>
      </section>

      <section className="editorial-strip">
        <div className="margin-note"><h2>Contact</h2></div>
        <div className="directory-grid">
          <a className="directory-row" href={mailto(CLUB_LINKS.emailSubjectReport)} style={{ textDecoration: 'none' }}><div><h2>Email</h2><p>{CLUB_LINKS.email}</p></div><span>↗</span></a>
          {CLUB_LINKS.discord && <a className="directory-row" href={CLUB_LINKS.discord} style={{ textDecoration: 'none' }}><div><h2>Discord</h2><p>Join the club server</p></div><span>↗</span></a>}
          {CLUB_LINKS.instagram && <a className="directory-row" href={CLUB_LINKS.instagram} style={{ textDecoration: 'none' }}><div><h2>Instagram</h2><p>@csulbbiotech</p></div><span>↗</span></a>}
          {CLUB_LINKS.clubSite && <a className="directory-row" href={CLUB_LINKS.clubSite} style={{ textDecoration: 'none' }}><div><h2>Club website</h2><p>CSULB Biotechnology Club</p></div><span>↗</span></a>}
        </div>
      </section>

      <p className="about-disclaimer">
        Listings are provided for information. Inclusion is not an endorsement by the
        CSULB Biotechnology Club or California State University, Long Beach. Always
        confirm details in the employer’s current posting.
      </p>
    </div>
  );
}
