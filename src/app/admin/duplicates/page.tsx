// Duplicate scanner: sweeps ALL existing opportunities (import-time dedupe
// only catches incoming rows) and clusters likely duplicates by evidence:
// same URL > same strict key > same posting family > fuzzy title.
import { similarity, OPPORTUNITY_FUZZY_THRESHOLD } from '@/lib/dedupe';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { DuplicateList, type DupCluster, type DupItem } from './duplicate-list';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  title: string;
  posting_url: string | null;
  dedupe_key: string | null;
  family_key: string | null;
  status: string;
  review_status: string;
  public_safe: boolean;
  last_seen_at: string;
  companies: { name: string } | null;
}

export default async function DuplicatesPage() {
  await requireOfficer();
  const db = createServiceClient();
  const { data } = await db
    .from('opportunities')
    .select('id, title, posting_url, dedupe_key, family_key, status, review_status, public_safe, last_seen_at, companies(name)')
    .neq('status', 'duplicate')
    .limit(2000);
  const rows = (data ?? []) as unknown as Row[];

  const toItem = (r: Row): DupItem => ({
    id: r.id,
    title: r.title,
    company: r.companies?.name ?? 'Unknown company',
    posting_url: r.posting_url,
    status: r.status,
    isPublic: r.public_safe && r.review_status === 'approved',
    last_seen_at: r.last_seen_at,
  });

  const clusters: DupCluster[] = [];
  const clustered = new Set<string>();
  const addClusters = (
    keyOf: (r: Row) => string | null,
    reason: string,
    confidence: DupCluster['confidence'],
  ) => {
    const byKey = new Map<string, Row[]>();
    for (const r of rows) {
      if (clustered.has(r.id)) continue;
      const k = keyOf(r);
      if (!k) continue;
      byKey.set(k, [...(byKey.get(k) ?? []), r]);
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      group.forEach((r) => clustered.add(r.id));
      clusters.push({ reason, confidence, items: group.map(toItem) });
    }
  };

  addClusters((r) => r.posting_url, 'Same posting link', 'high');
  addClusters((r) => r.dedupe_key, 'Same company and title', 'high');
  addClusters((r) => r.family_key, 'Same posting family (differs only by season or year)', 'repost');

  // Fuzzy pass: similar titles within the same company, pairwise.
  const remaining = rows.filter((r) => !clustered.has(r.id));
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const a = remaining[i], b = remaining[j];
      if (clustered.has(a.id) || clustered.has(b.id)) continue;
      if ((a.companies?.name ?? '') !== (b.companies?.name ?? '')) continue;
      const score = similarity(a.title.toLowerCase(), b.title.toLowerCase());
      if (score >= OPPORTUNITY_FUZZY_THRESHOLD) {
        clustered.add(a.id); clustered.add(b.id);
        clusters.push({
          reason: `Similar titles (${Math.round(score * 100)}% match)`,
          confidence: 'fuzzy',
          items: [toItem(a), toItem(b)],
        });
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Duplicate scanner</h1>
        <span className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          {rows.length} records scanned · {clusters.length} possible {clusters.length === 1 ? 'cluster' : 'clusters'}
        </span>
      </div>
      <p className="max-w-2xl text-sm" style={{ color: 'var(--ink-soft)' }}>
        Pick the record to keep in each cluster; the others are marked as duplicates
        pointing at it (never deleted). Posting-family matches are usually legitimate
        new cycles, so keeping both is often right for those.
      </p>
      <DuplicateList clusters={clusters} />
    </div>
  );
}
