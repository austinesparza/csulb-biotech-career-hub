import { CLUB_LINKS, mailto } from '@/lib/clubLinks';

export default function AboutPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">About the Career Hub</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">How listings get here</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Officers import the club internship spreadsheet, add postings by hand, and
          review student submissions. Every record is checked by an officer before it
          appears on the board. Nothing is collected automatically from other websites.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">What the labels mean</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          "Verified by officers" means an officer opened the posting link and confirmed
          it was live on the date shown. "Not yet re-verified" means the posting was
          imported as open but has not been re-checked recently, so confirm details at
          the source before applying.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Deadlines and when to apply</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Aim to apply two to four weeks before a posted deadline; many programs review
          applications as they arrive, and materials take longer to prepare than expected.
          "Rolling" means there is no fixed deadline and positions fill as qualified people
          apply, so earlier is better. Postings marked "closing soon" on the board have two
          weeks or less left. If a deadline has passed but the posting still shows as open
          at the source, it may be worth asking the employer directly.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">How the recommended sort works</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          The default order on the Internship Exchange is a simple, transparent point
          system that rates postings, never students. Every posting starts at 40 points,
          then gains or loses points for things most members care about: paid roles and
          stipends score higher, postings with a comfortable amount of time before the
          deadline score higher, past-deadline postings drop sharply, accessible locations
          (local or remote) add points, undergraduate-friendly eligibility adds points,
          and a missing application link costs points. Officers can see the exact point
          breakdown for every posting. The score only affects ordering; it never hides a
          posting, and you can always sort by deadline or newest instead.
        </p>
        <p style={{ color: 'var(--ink-soft)' }}>
          You can also tune the board for yourself under "Tune this board for you" on the
          Internship Exchange: pick focus areas and preferences, and matching postings get
          a visible "match for you" boost. Your choices are saved on your device only and
          are never sent anywhere.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Endorsement</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Listings are shared for information. Inclusion is not an endorsement of any
          employer or program by the club or by CSULB.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Report a problem</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Broken link, expired posting, or wrong details? Email{' '}
          <a href="mailto:csubiotechclub@gmail.com?subject=Career%20Hub%3A%20report%20a%20problem"
            className="underline" style={{ color: 'var(--brand-deep)' }}>
            csubiotechclub@gmail.com
          </a>{' '}
          or use the <a href="/submit" className="underline">submit page</a> and it will
          be fixed or removed, usually within a week.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Get in touch</h2>
        <ul className="space-y-1" style={{ color: 'var(--ink-soft)' }}>
          <li>
            Email:{' '}
            <a href={mailto(CLUB_LINKS.emailSubjectReport)} className="underline" style={{ color: 'var(--brand-deep)' }}>
              {CLUB_LINKS.email}
            </a>
          </li>
          <li>Submissions and corrections: <a href="/submit" className="underline">the submit page</a></li>
          {CLUB_LINKS.discord && (
            <li>Discord: <a href={CLUB_LINKS.discord} className="underline" style={{ color: 'var(--brand-deep)' }}>join the server</a></li>
          )}
          {CLUB_LINKS.instagram && (
            <li>Instagram: <a href={CLUB_LINKS.instagram} className="underline" style={{ color: 'var(--brand-deep)' }}>follow the club</a></li>
          )}
          {CLUB_LINKS.clubSite && (
            <li>Main club website: <a href={CLUB_LINKS.clubSite} className="underline" style={{ color: 'var(--brand-deep)' }}>{CLUB_LINKS.clubSite}</a></li>
          )}
          {CLUB_LINKS.officeHours && <li>Office hours: {CLUB_LINKS.officeHours}</li>}
        </ul>
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Officers: Discord, Instagram, and office hours appear here automatically once
          they are filled in (src/lib/clubLinks.ts).
        </p>
      </section>
    </div>
  );
}
