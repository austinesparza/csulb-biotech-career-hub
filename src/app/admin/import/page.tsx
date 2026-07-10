// Server component: loads selectable sources (provenance is required), then
// renders the client upload form.
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { ImportForm } from './import-form';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireOfficer();
  const db = createServiceClient();
  const { data: sources } = await db
    .from('source_records')
    .select('id, name')
    .order('name');

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">Import spreadsheet (CSV)</h1>
      <p className="text-sm text-gray-600">
        Export the internship sheet as CSV and upload it. Rows are stored raw, normalized,
        deduplicated, and queued as <code>needs_review</code>. Nothing goes public here.
        Records already approved and public are never changed by an import. Differences
        are flagged for review instead.
      </p>
      <ImportForm sources={sources ?? []} />
    </div>
  );
}
