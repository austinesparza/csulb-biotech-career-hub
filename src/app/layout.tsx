import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import { BrandMark } from '@/components/brand-mark';
import { PrivacyAnalytics } from '@/components/privacy-analytics';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import './globals.css';

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
              <Link href="/eligibility">Prepare</Link>
              <Link href="/companies">Employers</Link>
              <Link href="/about">About</Link>
            </nav>
            <Link href="/submit" className="masthead-action">Submit a role</Link>
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <div className="footer-banner">
            <div className="footer-banner-media">
              <Image
                className="footer-banner-image"
                src="/brand/hero-cells.webp"
                alt="Human fibroblast cells with stained nuclei and cytoskeleton"
                width={1600}
                height={1067}
                sizes="(max-width: 720px) 100vw, 72vw"
              />
              <div className="footer-banner-copy">
                <p>See where science can take you.</p>
                <Link href="/internships">Explore current opportunities <span aria-hidden="true">→</span></Link>
              </div>
            </div>
            <div className="footer-brand-panel">
              <BrandMark className="footer-brand-mark" />
              <div className="footer-brand-name"><span>CSULB</span> Biotech<br />Career Hub</div>
              <p>Built in Long Beach.<br />For undergraduate and graduate students.</p>
            </div>
          </div>
          <div className="site-wrap footer-grid">
            <div className="footer-identity">
              <div className="footer-title"><span>CSULB</span> Biotech Career Hub</div>
              <p>Opportunities, application timing, and evidence gathered by the CSULB Biotechnology Club.</p>
            </div>
            <div className="footer-links">
              <div><span>Explore</span><Link href="/internships">Opportunities</Link><Link href="/calendar">Calendar</Link><Link href="/companies">Employers</Link></div>
              <div><span>Career Hub</span><Link href="/eligibility">Prepare</Link><Link href="/about">About</Link><Link href="/submit">Submit a role</Link></div>
              <div><span>Details</span><Link href="/privacy">Privacy</Link><Link href="/image-credits">Image credits</Link><Link href="/admin">Officer portal</Link><a href={mailto(CLUB_LINKS.emailSubjectReport)}>Contact the club</a></div>
            </div>
          </div>
        </footer>
        <PrivacyAnalytics />
      </body>
    </html>
  );
}
