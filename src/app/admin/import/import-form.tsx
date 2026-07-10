'use client';
// CSV upload UI. For MVP this commits directly; Issue #12 adds a dry-run preview step.
import { useState, useTransition } from 'react';
import { importCsv, type ImportSummary } from './actions';

export function ImportForm({ sources }: { sources: Array<{ id: string; name: string }> }) {
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          setError(null);
          startTransition(async () => {
            try {
              setSummary(await importCsv(formData));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Import failed');
            }
          });
        }}
        className="space-y-4"
      >
        <label className="block text-sm">
          Source <span className="text-red-600">*</span>
          <select name="source_record_id" required defaultValue=""
            className="mt-1 block w-full rounded border px-3 py-2">
            <option value="" disabled>Select where this file comes from…</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <input type="file" name="file" accept=".csv,text/csv" required className="block" />
        <button disabled={pending} className="rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-50">
          {pending ? 'Importing…' : 'Import'}
        </button>
      </form>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="rounded border p-4 text-sm">
          <p className="font-semibold">Import complete</p>
          <p>
            {summary.totalRows} rows · {summary.inserted} new · {summary.updated} refreshed ·{' '}
            {summary.touched} approved records touched (last-seen only)
            {summary.changeFlags > 0 && `, ${summary.changeFlags} flagged as changed`} ·{' '}
            {summary.duplicatesFlagged} possible duplicates/reposts · {summary.errors.length} errors
          </p>
          {summary.unmatchedHeaders.length > 0 && (
            <p className="mt-2 text-amber-700">Ignored columns: {summary.unmatchedHeaders.join(', ')}</p>
          )}
          {summary.errors.slice(0, 10).map((e) => (
            <p key={e.row} className="text-red-700">Row {e.row}: {e.message}</p>
          ))}
          <a href="/admin/review" className="mt-3 inline-block underline">Go to review queue →</a>
        </div>
      )}
    </div>
  );
}
