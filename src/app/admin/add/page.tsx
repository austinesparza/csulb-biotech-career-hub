// Server component: loads selectable sources, then renders the client form.
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { QuickAddForm } from './quick-add-form';

export const dynamic = 'force-dynamic';

export default async function QuickAddPage() {
  await requireOfficer();
  const db = createServiceClient();
  const { data: sources } = await db
    .from('source_records')
    .select('id, name')
    .order('name');
  const list = sources ?? [];
  const defaultSourceId = list.find((s) => s.name === 'Manual Officer Entry')?.id ?? '';

  return (
    <div className="admin-page-flow max-w-3xl">
      <header className="admin-page-head">
        <div className="admin-page-head-copy">
          <div className="admin-page-eyebrow">Curation</div>
          <h1 className="admin-page-title">Add a posting</h1>
          <p className="admin-page-deck">
            Paste an official posting to prefill a private draft, correct anything the parser missed, and send it into officer review. Nothing publishes from this page.
          </p>
        </div>
        <span className="admin-status-badge admin-status-good">Private draft</span>
      </header>
      <QuickAddForm sources={list} defaultSourceId={defaultSourceId} />
    </div>
  );
}
