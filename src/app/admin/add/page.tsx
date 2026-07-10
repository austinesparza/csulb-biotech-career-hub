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
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Add a posting</h1>
      <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
        Found a role while browsing? Paste the posting text below to prefill the form,
        fix anything the parser got wrong, and save. It lands in the review queue, not
        on the public board.
      </p>
      <QuickAddForm sources={list} defaultSourceId={defaultSourceId} />
    </div>
  );
}
