import type { UserSubmission } from '@/lib/types';
import { convertSubmissionToDraft, resolveSubmission } from './actions';

const inputClass = 'mt-1 w-full rounded-md border bg-white px-3 py-2 font-normal';

function payloadText(row: UserSubmission, key: string): string {
  const value = row.payload?.[key];
  return typeof value === 'string' ? value : '';
}

export function SubmissionList({ rows }: { rows: UserSubmission[] }) {
  if (!rows.length) return <p>No new submissions.</p>;
  return <ul className="review-records">{rows.map((row) => (
    <li key={row.id} className="review-record">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{row.submission_type === 'opportunity' ? 'Opportunity suggestion' : row.submission_type}</h2>
        <span className="text-sm">{new Date(row.created_at).toLocaleString()}</span>
      </div>
      <p className="mt-2 text-sm"><a href={payloadText(row, 'url')} target="_blank" rel="noopener noreferrer">Open submitted link ↗</a></p>
      {(row.submitter_name || row.submitter_email) && <p className="mt-2 text-sm">Private contact: {row.submitter_name ?? 'Name not provided'}{row.submitter_email ? ` · ${row.submitter_email}` : ''}</p>}
      {row.submission_type === 'opportunity' ? (
        <form action={convertSubmissionToDraft} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={row.id} />
          <label>Company<input className={inputClass} name="company" required defaultValue={payloadText(row, 'company')} /></label>
          <label>Role title<input className={inputClass} name="title" required defaultValue={payloadText(row, 'title')} /></label>
          <label className="sm:col-span-2">Official link<input className={inputClass} name="posting_url" type="url" required defaultValue={payloadText(row, 'url')} /></label>
          <label className="sm:col-span-2">Private review notes<textarea className={inputClass} name="details" defaultValue={payloadText(row, 'details')} /></label>
          <button className="primary-button justify-self-start">Create review draft</button>
        </form>
      ) : (
        <p className="mt-3 whitespace-pre-wrap text-sm">{payloadText(row, 'details') || 'No additional details.'}</p>
      )}
      <form action={resolveSubmission} className="mt-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={row.id} />
        <input className="rounded-md border bg-white px-3 py-2" name="notes" placeholder="Officer note (optional)" />
        {row.submission_type !== 'opportunity' && <button className="secondary-button" name="status" value="approved">Mark handled</button>}
        <button className="secondary-button" name="status" value="rejected">Reject</button>
        <button className="secondary-button" name="status" value="spam">Spam</button>
      </form>
    </li>
  ))}</ul>;
}
