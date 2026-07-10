import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createClient();
  const { count } = await supabase
    .from('public_opportunities')
    .select('*', { count: 'exact', head: true });

  const cards = [
    { href: '/internships', title: 'Internship Exchange', text: `${count ?? 0} open opportunities, reviewed by officers` },
    { href: '/companies', title: 'Company Directory', text: 'Organizations that have offered roles we tracked, past and present' },
    { href: '/submit', title: 'Submit an Opportunity', text: 'Found something? Share it with the club.' },
    { href: '/about', title: 'About the Career Hub', text: 'How listings get reviewed and published' },
  ];

  return (
    <div className="space-y-10">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Find your next opportunity</h1>
        <p className="mt-3" style={{ color: 'var(--ink-soft)' }}>
          Every listing here was imported or submitted, then reviewed by a club officer
          before publishing. Each card shows its source and when it was last checked.
        </p>
        <Link
          href="/internships"
          className="mt-5 inline-block rounded-md px-5 py-2.5 text-sm font-medium text-white"
          style={{ background: 'var(--ink)' }}
        >
          Browse internships
        </Link>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-xl bg-white p-5 transition-colors hover:bg-[var(--brand-soft)]"
            style={{ border: '1px solid var(--line)' }}
          >
            <h2 className="font-semibold">{c.title}</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-soft)' }}>{c.text}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}
