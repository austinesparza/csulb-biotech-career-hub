import type { Metadata } from 'next';
import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

export const metadata: Metadata = {
  title: 'Privacy | CSULB Biotech Career Hub',
  description: 'How the CSULB Biotech Career Hub handles information.',
};

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium" style={{ color: 'var(--brand-deep)' }}>
          Effective September 8, 2026
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          This is a student-maintained resource from the CSULB Biotechnology Club,
          not an official California State University, Long Beach service.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Browsing and submissions</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Anyone can browse without an account. If you submit a role or correction,
          we store the information you enter. Your name and email are optional, visible
          only to authorized club officers, and never published with a listing.
        </p>
        <p style={{ color: 'var(--ink-soft)' }}>
          Filter preferences stay in your browser. We use Vercel Web Analytics for
          aggregate public-page usage. Analytics is disabled on officer, authentication,
          and API routes, and query parameters are removed before an event is sent.
          Vercel and Supabase may also process routine technical logs needed to host
          and protect the site. We do not sell personal information.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Google account access</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          The officer reminder system uses Gmail send-only access. It can send review
          reminders from an authorized account, but it cannot read, edit, or delete
          email. OAuth credentials are protected and are not visible to site visitors.
        </p>
        <p style={{ color: 'var(--ink-soft)' }}>
          Our use and transfer of information received from Google APIs follows the
          Google API Services User Data Policy, including its Limited Use requirements.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Retention and contact</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          We keep submissions and operational records only as long as needed to run the
          hub. To ask a privacy question or request deletion of information you submitted,{' '}
          <a
            href={mailto('Career Hub: privacy request')}
            className="underline"
            style={{ color: 'var(--brand-deep)' }}
          >
            email {CLUB_LINKS.email}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
