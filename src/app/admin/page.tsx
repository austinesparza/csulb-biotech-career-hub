// Admin dashboard home: work-queue counts. Extend per docs/05-ui-plan.md.
import Link from 'next/link';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  await requireOfficer();
  const db = createServiceClient();
  const in14 = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const [needsReview, expiring, openTasks, newSubmissions] = await Promise.all([
    db.from('opportunities').select('*', { count: 'exact', head: true }).eq('status', 'needs_review'),
    db.from('opportunities').select('*', { count: 'exact', head: true })
      .in('status', ['open_verified', 'open_unverified'])
      .gte('deadline', today).lte('deadline', in14),
    db.from('review_tasks').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('user_submissions').select('*', { count: 'exact', head: true }).eq('status', 'new'),
  ]);

  const cards = [
    { href: '/admin/review', label: 'Needing review', count: needsReview.count ?? 0 },
    { href: '/admin/review', label: 'Expiring in 14 days', count: expiring.count ?? 0 },
    { href: '/admin/review?tab=tasks', label: 'Open review tasks', count: openTasks.count ?? 0 },
    { href: '/admin/review?tab=submissions', label: 'New submissions', count: newSubmissions.count ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Officer dashboard</h1>
      <div className="grid gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-xl bg-white p-4 hover:bg-[var(--brand-soft)]"
            style={{ border: '1px solid var(--line)' }}>
            <div className="text-2xl font-semibold">{c.count}</div>
            <div className="text-sm" style={{ color: 'var(--ink-soft)' }}>{c.label}</div>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/admin/import" className="rounded-md px-4 py-2 font-medium text-white" style={{ background: 'var(--ink)' }}>
          Import CSV
        </Link>
        <Link href="/admin/add" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Add a posting
        </Link>
        <Link href="/admin/review" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Open review queue
        </Link>
        <Link href="/admin/duplicates" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Scan for duplicates
        </Link>
        <Link href="/admin/ingestion" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Run ingestion
        </Link>
        <a href="/api/export?format=csv" className="rounded-md bg-white px-4 py-2" style={{ border: '1px solid var(--line)' }}>
          Export approved (CSV)
        </a>
      </div>
    </div>
  );
}
