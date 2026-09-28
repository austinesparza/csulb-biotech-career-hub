import type { ReviewTask } from '@/lib/types';
import { resolveReviewTask } from './actions';

interface QuotedGate {
  value?: string;
  quote?: string | null;
}

export interface VerificationTaskEvidence {
  id: string;
  observed_url: string;
  final_url: string | null;
  retrieved_at: string | null;
  page_state: string;
  outcome: string;
  requisition_id: string | null;
  content_sha256: string | null;
  snapshot_storage_path: string | null;
  gates: Record<string, QuotedGate>;
  comparison: Record<string, unknown>;
  duplicates: { matches?: Array<{ table?: string; id?: string; basis?: string }>; related?: Array<{ table?: string; id?: string; basis?: string }> };
}

const GATES: Array<[string, string]> = [
  ['deadline', 'Deadline'], ['term', 'Term'], ['degreeLevel', 'Degree level'],
  ['yearInProgram', 'Year in program'], ['continuedEnrollment', 'Continued enrollment'],
  ['institutionRestriction', 'Institution'], ['academicCredit', 'Academic credit'],
  ['workAuthorization', 'Work authorization'],
];

function httpsUrl(value: string | null): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}

function firstHttpsUrl(value: string | null): string | null {
  return value?.match(/https:\/\/[^\s<>]+/)?.[0] ?? null;
}

export function VerificationEvidence({ record }: { record: VerificationTaskEvidence }) {
  const sourceUrl = httpsUrl(record.final_url) ?? httpsUrl(record.observed_url);
  return <details className="mt-3 rounded-md border p-3">
    <summary className="cursor-pointer font-semibold">Employer page evidence and duplicate check</summary>
    <p className="mt-2 text-sm">Observed {record.retrieved_at
      ? `${new Date(record.retrieved_at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC`
      : 'at an unknown time'} · {record.page_state.replaceAll('_', ' ')} · Requisition {record.requisition_id ?? 'unknown'}</p>
    {sourceUrl ? <p className="mt-2 text-sm"><a href={sourceUrl} target="_blank" rel="noreferrer">Check the live employer page</a></p> : null}
    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{GATES.map(([key, label]) => {
      const gate = record.gates?.[key];
      return <div key={key}>
        <dt className="font-semibold">{label}</dt>
        <dd>{gate?.value?.replaceAll('_', ' ') ?? 'unknown'}</dd>
        {gate?.quote ? <dd className="mt-1 text-sm">“{gate.quote}”</dd> : null}
      </div>;
    })}</dl>
    <p className="mt-3 text-sm">Employer attribution: {String((record.comparison?.employer as { status?: string } | undefined)?.status ?? 'unknown').replaceAll('_', ' ')}.
      {(record.duplicates?.matches?.length ?? 0) > 0 ? ` ${record.duplicates.matches!.length} matching earlier records.` : ' No matching earlier records.'}
      {(record.duplicates?.related?.length ?? 0) > 0 ? ` ${record.duplicates.related!.length} related requisitions kept separate.` : ''}</p>
    <p className="mt-2 text-xs">Private snapshot: {record.snapshot_storage_path ?? 'not stored'} · SHA-256 {record.content_sha256 ?? 'unknown'}</p>
    <p className="mt-2 text-sm">Confirm Apply, employer, degree, institution, dates, and work authorization on the live page. Then <a href="/admin/add">create a private opportunity draft</a> if it is distinct. This record cannot publish by itself.</p>
  </details>;
}

export function TaskList({ rows, verificationById = {} }: { rows: ReviewTask[]; verificationById?: Record<string, VerificationTaskEvidence> }) {
  if (!rows.length) return <p>No open review tasks.</p>;
  return <ul className="review-records">{rows.map((row) => {
    const sourceUrl = firstHttpsUrl(row.notes);
    return <li key={row.id} className="review-record">
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{row.task_type.replaceAll('_', ' ')}</strong>
        <span className="text-sm">{new Date(row.created_at).toLocaleDateString()}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{row.notes ?? 'No task note.'}</p>
      {sourceUrl ? <p className="mt-2 text-sm">
        <a href={sourceUrl} target="_blank" rel="noreferrer">Open captured source</a>
      </p> : null}
      {row.entity_table === 'user_submissions' ? <p className="mt-2 text-sm"><a href={'/admin/review?tab=submissions#submission-' + row.entity_id}>Open research record</a></p> : null}
      {row.entity_table === 'posting_verifications' ? verificationById[row.entity_id]
        ? <VerificationEvidence record={verificationById[row.entity_id]} />
        : <p className="mt-2 text-sm" role="alert">Verification evidence is unavailable. Do not close this task until the archive can be inspected.</p> : null}
      {row.entity_table === 'opportunities' && row.task_type === 'stale_record' ? <p className="mt-2 text-sm"><a href={'/admin/manage#opportunity-' + row.entity_id}>Recheck this published record</a></p> : null}
      <p className="mt-2 text-xs">{row.entity_table} · {row.entity_id}</p>
      {row.task_type !== 'stale_record' && <form action={resolveReviewTask} className="mt-3 flex gap-2">
        <input type="hidden" name="id" value={row.id} />
        <button className="secondary-button" name="status" value="done">Done</button>
        <button className="secondary-button" name="status" value="dismissed">Dismiss</button>
      </form>}
    </li>;
  })}</ul>;
}
