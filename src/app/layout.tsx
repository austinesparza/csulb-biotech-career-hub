import type { Metadata } from 'next';
import Link from 'next/link';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';
import './globals.css';

export const metadata: Metadata = {
  title: 'CSULB Biotech Career Hub',
  description: 'Internships, companies, mentors, and career resources, reviewed by club officers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <div style={{ height: 3, background: 'var(--brand)' }} />
        <header className="sticky top-0 z-10" style={{ borderBottom: '1px solid var(--line)', background: '#fff' }}>
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
            <Link href="/" className="font-medium tracking-tight">
              CSULB Biotechnology Club <span style={{ color: 'var(--brand-deep)' }}>Career Hub</span>
            </Link>
            <span className="grow" />
            <Link href="/internships" className="hover:underline" style={{ color: 'var(--ink-soft)' }}>Internships</Link>
            <Link href="/companies" className="hover:underline" style={{ color: 'var(--ink-soft)' }}>Companies</Link>
            <Link href="/submit" className="hover:underline" style={{ color: 'var(--ink-soft)' }}>Submit</Link>
            <Link href="/about" className="hover:underline" style={{ color: 'var(--ink-soft)' }}>About</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="py-8 text-center text-xs" style={{ borderTop: '1px solid var(--line)', color: 'var(--ink-soft)' }}>
          <p>
            Listings are shared for informational purposes. Inclusion is not an endorsement
            by the club or CSULB.
          </p>
          <p className="mt-1">
            Found a broken link or outdated posting?{' '}
            <a href={mailto(CLUB_LINKS.emailSubjectReport)} className="underline">
              Email us at {CLUB_LINKS.email}
            </a>
            {' '}or use the <Link href="/submit" className="underline">submit page</Link>.
          </p>
          <p className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {CLUB_LINKS.clubSite && <a href={CLUB_LINKS.clubSite} className="underline">Club website</a>}
            {CLUB_LINKS.discord && <a href={CLUB_LINKS.discord} className="underline">Discord</a>}
            {CLUB_LINKS.instagram && <a href={CLUB_LINKS.instagram} className="underline">Instagram</a>}
            {CLUB_LINKS.officeHours && <span>Office hours: {CLUB_LINKS.officeHours}</span>}
          </p>
        </footer>
      </body>
    </html>
  );
}
