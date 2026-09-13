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
  const sheetReady = googleSheetsConfigured();

  return (
    <div className="admin-page-flow max-w-4xl">
      <header className="admin-page-head">
        <div className="admin-page-head-copy">
          <div className="admin-page-eyebrow">Officer handoff</div>
          <h1 className="admin-page-title">Spreadsheet intake</h1>
          <p className="admin-page-deck">
            Move scheduled or on-command discoveries into the private review workflow. Rows are stored raw, normalized, deduplicated, and queued for review. Approved public records are never silently overwritten.
          </p>
        </div>
        <span className={sheetReady ? 'admin-status-badge admin-status-good' : 'admin-status-badge admin-status-watch'}>
          {sheetReady ? 'Google Sheet connected' : 'CSV fallback available'}
        </span>
      </header>

      <aside className="rounded-xl p-5 text-sm" style={{ border: '1px solid #e5c875', background: 'var(--gold-tint)', color: '#67480f' }}>
        <div className="admin-page-eyebrow" style={{ color: '#7e5310' }}>Publication boundary</div>
        <h2 className="text-xl font-semibold" style={{ color: '#4f3c16' }}>Sheet approval is not website approval</h2>
        <p className="mt-2 max-w-3xl">
          Machine discoveries are pushed into system-owned Sheet columns without overwriting officer notes or decisions. Publish Decision and Public Safe cells remain workspace notes only. Pull decisions, then approve the private draft in the signed-in review queue.
        </p>
      </aside>

      {sheetReady ? <SheetSync /> : <div className="rounded-xl bg-white p-5 text-sm" style={{ border: '1px solid var(--line-strong)' }}>
        <strong>Direct Google Sheet sync is not configured.</strong>
        <p className="mt-1" style={{ color: 'var(--ink-soft)' }}>CSV upload remains available below, so intake can continue without Google.</p>
      </div>}

      <section className="rounded-xl bg-white p-5" style={{ border: '1px solid var(--line)' }}>
        <div className="admin-page-eyebrow">Fallback intake</div>
        <h2 className="text-xl font-semibold">Upload CSV</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-soft)' }}>Use an Excel export or this path when Google is unavailable.</p>
        <div className="mt-4">
          <ImportForm sources={sources ?? []} />
        </div>
      </section>
    </div>
  );
}
