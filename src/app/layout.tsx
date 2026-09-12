import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { BrandMark } from '@/components/brand-mark';
import { PrivacyAnalytics } from '@/components/privacy-analytics';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'CSULB Biotech Career Hub',
  description: 'Graduate-accessible biotechnology opportunities, source evidence, and career guidance maintained by the CSULB Biotechnology Club.',
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
            <Link href="/" className="brand-lockup" aria-label="CSULB Biotech Career Hub home">
              <BrandMark className="brand-mark" />
              <span className="brand-name">
                <span className="brand-campus">CSULB</span>
                <span className="brand-product">Biotech Career Hub</span>
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
            <div className="footer-identity">
              <BrandMark className="brand-mark" />
              <div>
                <div className="footer-title"><span>CSULB</span> Biotech Career Hub</div>
                <p>Built by the CSULB Biotechnology Club for students navigating science careers. Always verify the live employer posting before applying.</p>
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
