// Server component: loads selectable sources (provenance is required), then
// renders the client upload form.
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { googleSheetsConfigured } from '@/lib/google-sheets';
import { ImportForm } from './import-form';
import { SheetSync } from './sheet-sync';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireOfficer();
  const db = createServiceClient();
  const { data: sources } = await db
    .from('source_records')
    .select('id, name')
    .order('name');

  return (
    <div className="max-w-xl space-y-8">
      <div>
      <h1 className="text-2xl font-bold">Spreadsheet intake</h1>
      <p className="text-sm text-gray-600">
        Rows are stored raw, normalized,
        deduplicated, and queued as <code>needs_review</code>. Nothing goes public here.
        Records already approved and public are never changed by an import. Differences
        are flagged for review instead.
      </p>
      </div>
      <aside className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950" style={{ border: '1px solid #f3d38a' }}>
        <p className="font-semibold">Sheet approval is not website approval</p>
        <p className="mt-1">
          Publish Decision and Public Safe cells are preserved as officer workspace notes,
          but they cannot publish a record. Sync first, then approve the private draft in
          the signed-in review queue. The public site updates as soon as that approval succeeds.
        </p>
      </aside>
      {googleSheetsConfigured() ? <SheetSync /> : <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        Direct Google Sheet sync is not configured. CSV upload remains available below.
      </div>}
      <section className="space-y-3">
        <h2 className="font-semibold">Upload CSV</h2>
        <p className="text-sm text-gray-600">Use this fallback for Excel files exported as CSV or when Google is unavailable.</p>
      <ImportForm sources={sources ?? []} />
      </section>
    </div>
  );
}
