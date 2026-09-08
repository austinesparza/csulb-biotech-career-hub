import type { Metadata } from 'next';
import Link from 'next/link';
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
          The CSULB Biotechnology Club Career Hub is a student-maintained career
          resource. It is not an official California State University, Long Beach
          service.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Information we handle</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          You can browse the public site without creating an account. If you submit an
          opportunity or correction, we store the link and details you provide, plus
          your name and email only when you choose to include them. Contact information
          is visible only to authorized club officers and is not published with a
          listing.
        </p>
        <p style={{ color: 'var(--ink-soft)' }}>
          Board preferences are saved in your browser and are not sent to our database.
          Our hosting and database providers may process standard technical information,
          such as request, device, and security logs, to operate and protect the service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">How we use information</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          We use submitted information to verify opportunities, correct listings,
          respond to questions, maintain the review queue, and protect the service.
          Optional contact information may be used to clarify a submission. We do not
          sell personal information.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Google account access</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Our internal review automation requests Gmail send-only access to send review
          reminders from an authorized club administrator. It does not request permission
          to read, modify, or delete mailbox content. OAuth credentials are stored as
          protected secrets and are not exposed to public site visitors.
        </p>
        <p style={{ color: 'var(--ink-soft)' }}>
          Our use and transfer of information received from Google APIs follows the
          Google API Services User Data Policy, including its Limited Use requirements.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Service providers and retention</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          The site uses Vercel for hosting, Supabase for database and officer
          authentication services, GitHub for deployment automation, and Google to send
          authorized review emails. We retain submissions and operational records only
          as long as reasonably needed to run and document the resource. You may ask us
          to review or delete contact information you submitted.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Contact</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Privacy question or deletion request?{' '}
          <a
            href={mailto('Career Hub: privacy request')}
            className="underline"
            style={{ color: 'var(--brand-deep)' }}
          >
            Email {CLUB_LINKS.email}
          </a>
          . You can also read more about the project on the{' '}
          <Link href="/about" className="underline">
            About page
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
