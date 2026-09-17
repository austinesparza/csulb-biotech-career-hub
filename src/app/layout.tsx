import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { BrandMark } from '@/components/brand-mark';
import { PrivacyAnalytics } from '@/components/privacy-analytics';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import './career-hub-v2.css';
import './mobile-polish.css';
import './site-refinement.css';
import './design-reduction.css';

export const metadata: Metadata = {
  title: 'CSULB Biotech Career Hub',
  description: 'Biotechnology opportunities, source evidence, and career guidance maintained by the CSULB Biotechnology Club.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request CSP nonce can only be attached to Next.js scripts during
  // dynamic rendering. Static HTML is created before the nonce exists.
  await connection();

  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to main content</a>
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
              <Link href="/calendar">Calendar</Link>
              <Link href="/eligibility">Application help</Link>
              <Link href="/companies">Employers</Link>
              <Link href="/about">About</Link>
              <Link href="/submit">Submit a role</Link>
            </nav>
            <Link href="/internships" className="masthead-action">Browse roles</Link>
            <details className="mobile-nav">
              <summary aria-label="Open navigation">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span className="mobile-nav-label">Menu</span>
              </summary>
              <nav aria-label="Mobile navigation">
                <Link href="/internships">Opportunities</Link>
                <Link href="/calendar">Calendar</Link>
                <Link href="/eligibility">Application help</Link>
                <Link href="/companies">Employers</Link>
                <Link href="/about">About</Link>
                <Link href="/submit">Submit a role</Link>
              </nav>
            </details>
          </div>
        </header>
        <main className="site-main" id="main-content">{children}</main>
        <footer className="site-footer site-footer-compact">
          <div className="site-wrap footer-grid">
            <div className="footer-identity">
              <BrandMark className="footer-compact-mark" />
              <div>
                <div className="footer-title"><span>CSULB</span> Biotech Career Hub</div>
              </div>
            </div>
            <div className="footer-links">
              <div><span>Explore</span><Link href="/internships">Opportunities</Link><Link href="/calendar">Calendar</Link><Link href="/companies">Employers</Link></div>
              <div><span>Career Hub</span><Link href="/eligibility">Application help</Link><Link href="/about">About</Link><Link href="/submit">Submit a role</Link></div>
              <div><span>Details</span><Link href="/privacy">Privacy</Link><Link href="/image-credits">Image credits</Link><Link href="/admin">Officer portal</Link><a href={mailto(CLUB_LINKS.emailSubjectReport)}>Contact the club</a></div>
            </div>
          </div>
        </footer>
        <PrivacyAnalytics />
      </body>
    </html>
  );
}
