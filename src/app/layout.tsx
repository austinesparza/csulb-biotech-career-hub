import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { BrandMark } from '@/components/brand-mark';
import { PrivacyAnalytics } from '@/components/privacy-analytics';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'CSULB Graduate Internship Hub',
  description: 'Graduate-level and graduate-accessible biotechnology opportunities, reviewed by CSULB Biotechnology Club officers.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request CSP nonce can only be attached to Next.js scripts during
  // dynamic rendering. Static HTML is created before the nonce exists.
  await connection();

  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="site-wrap masthead-inner">
            <Link href="/" className="brand-lockup" aria-label="CSULB Graduate Internship Hub home">
              <BrandMark className="brand-mark" />
              <span>
                <span className="brand-kicker">CSULB Biotechnology Club</span>
                <span className="brand-name">Graduate Internship Hub</span>
              </span>
            </Link>
            <nav className="site-nav" aria-label="Primary navigation">
              <Link href="/internships">Opportunities</Link>
              <Link href="/calendar">Calendar</Link>
              <Link href="/eligibility">Eligibility</Link>
              <Link href="/companies">Employers</Link>
              <Link href="/about">About</Link>
            </nav>
            <Link href="/submit" className="masthead-action">Submit a role</Link>
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <div className="site-wrap footer-grid">
            <div style={{ display: 'flex', gap: 12 }}>
              <BrandMark className="brand-mark" />
              <div>
                <div className="footer-title">CSULB Biotechnology Club</div>
                <p>A student-maintained resource for graduate students. Always verify the live employer posting before applying.</p>
              </div>
            </div>
            <div className="mono" style={{ textAlign: 'right' }}>
              <Link href="/privacy">Privacy</Link><br />
              <Link href="/submit">Report a change</Link><br />
              <Link href="/admin">Officer portal</Link><br />
              <a href={mailto(CLUB_LINKS.emailSubjectReport)}>Contact the club</a>
            </div>
          </div>
        </footer>
        <PrivacyAnalytics />
      </body>
    </html>
  );
}
