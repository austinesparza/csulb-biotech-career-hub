import type { UserSubmission } from '@/lib/types';
import { convertSubmissionToDraft, resolveSubmission } from './actions';

const inputClass = 'mt-1 w-full rounded-md border bg-white px-3 py-2 font-normal';
const researchLabels: Record<string, string> = {
  priority_source_research: 'Find employer posting',
  off_cycle_check: 'Check term and source',
  special_or_identity_check: 'Check identity or special gate',
  adjacent_or_unknown: 'Check scope and source',
  low_signal_or_past_cycle: 'Low signal or past cycle',
};

function payloadText(row: UserSubmission, key: string): string {
  const value = row.payload?.[key];
  return typeof value === 'string' ? value : '';
}

function isSourceResearch(row: UserSubmission): boolean {
  return payloadText(row, 'intake_stage') === 'source_research';
}

function priority(row: UserSubmission): number {
  const value = row.payload?.research_priority;
  return typeof value === 'number' ? value : 100;
}

function SubmissionCard({ row, research }: { row: UserSubmission; research: boolean }) {
  const group = researchLabels[payloadText(row, 'research_group')] || 'Find employer posting';
  const label = research ? group : row.submission_type === 'opportunity' ? 'Opportunity suggestion' : row.submission_type;
  const body = <>
    {payloadText(row, 'url') ? <p className="mt-2 text-sm"><a href={payloadText(row, 'url')} target="_blank" rel="noopener noreferrer">Open submitted link ↗</a></p> : <p className="mt-2 text-sm">No role-specific link supplied. Find the employer posting before creating a draft.</p>}
    {(row.submitter_name || row.submitter_email) && <p className="mt-2 text-sm">Private contact: {row.submitter_name ?? 'Name not provided'}{row.submitter_email ? ' · ' + row.submitter_email : ''}</p>}
    {research && <p className="mt-2 text-sm">Opening: unknown · MSc eligibility: unknown · Officer decision: pending. <a href="https://github.com/austinesparza/csulb-biotech-career-hub/blob/research/2026-09-24-internship-gaps/docs/research/2026-09-24-linkedin-screenshot-audit.md" target="_blank" rel="noopener noreferrer">Screenshot audit ↗</a></p>}
    {research && <p className="mt-2 text-sm"><strong>Next check:</strong> {payloadText(row, 'next_step')}</p>}
    {row.submission_type === 'opportunity' ? (
      <form action={convertSubmissionToDraft} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={row.id} />
        <label>Company<input className={inputClass} name="company" required defaultValue={payloadText(row, 'company')} /></label>
        <label>Role title<input className={inputClass} name="title" required defaultValue={payloadText(row, 'title')} /></label>
        <label className="sm:col-span-2">{research ? 'Individual employer or ATS posting' : 'Official link'}<input className={inputClass} name="posting_url" type="url" required defaultValue={payloadText(row, 'url')} /></label>
        <label className="sm:col-span-2">Private review notes<textarea className={inputClass} name="details" defaultValue={payloadText(row, 'details')} /></label>
        {research && <label className="sm:col-span-2 flex items-start gap-2 text-sm"><input type="checkbox" name="source_confirmed" required className="mt-1" /><span>I checked this individual posting on the employer site or its ATS. I will confirm the full gates before publishing.</span></label>}
        <button className="primary-button justify-self-start">Create private review draft</button>
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
  </>;

  return <li id={"submission-" + row.id} className="review-record" key={row.id}>
    {research ? <details>
      <summary className="cursor-pointer"><strong>{payloadText(row, 'company') || 'Employer unknown'}: {payloadText(row, 'title') || 'Untitled role'}</strong><span className="ml-2 text-sm">#{payloadText(row, 'catalog_id')} · {label} · missing role link</span></summary>
      {body}
    </details> : <>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{label}</h2><span className="text-sm">{new Date(row.created_at).toLocaleString()}</span></div>
      {body}
    </>}
  </li>;
}

export function SubmissionList({ rows }: { rows: UserSubmission[] }) {
  if (!rows.length) return <p>No new submissions.</p>;
  const research = rows.filter(isSourceResearch).sort((a, b) => priority(a) - priority(b) || payloadText(a, 'catalog_id').localeCompare(payloadText(b, 'catalog_id')));
  const suggestions = rows.filter((row) => !isSourceResearch(row));
  return <div className="grid gap-8">
    <section aria-label="Student submissions">
      <h2 className="text-lg font-semibold">Student submissions ({suggestions.length})</h2>
      {suggestions.length ? <ul className="review-records">{suggestions.map((row) => <SubmissionCard key={row.id} row={row} research={false} />)}</ul> : <p>No student submissions waiting.</p>}
    </section>
    {research.length > 0 && <section aria-label="Source research">
      <h2 className="text-lg font-semibold">Source research ({research.length})</h2>
      <p className="mt-2 text-sm">These screenshot leads lack individual employer postings. They are organized for research, not ready for a publication decision. Open a row to see its notes and add the exact posting.</p>
      <ul className="review-records">{research.map((row) => <SubmissionCard key={row.id} row={row} research />)}</ul>
    </section>}
  </div>;
}
