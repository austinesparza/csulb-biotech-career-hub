'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OpportunityCorrectionDraft } from '@/lib/opportunity-corrections';
import type { AudienceBucket, GraduateStage, PaidStatus } from '@/lib/types';
import { restoreOpportunityRevision, saveOpportunityCorrection, unpublishOpportunity } from './actions';

export interface RevisionSummary {
  id: string;
  revisionNumber: number;
  action: 'correction' | 'unpublish' | 'restore';
  reason: string;
  changedBy: string;
  createdAt: string;
  changes: string[];
}

export interface ManagedOpportunity {
  id: string;
  companyName: string;
  updatedAt: string;
  live: boolean;
  draft: OpportunityCorrectionDraft;
  revisions: RevisionSummary[];
}

const AUDIENCES: Array<[AudienceBucket, string]> = [
  ['graduate', "Master's accessible"],
  ['mixed', "Master's and undergraduate"],
];
const STAGES: Array<[GraduateStage, string]> = [
  ['msc_year_1', "First-year master's"],
  ['msc_year_2', "Second-year master's"],
  ['msc_any', "Any master's year"],
  ['mixed_graduate', "Master's and doctoral"],
  ['graduate_unspecified', 'Graduate, year not stated'],
];
const PAID: Array<[PaidStatus, string]> = [
  ['paid', 'Paid'], ['stipend', 'Stipend'], ['unpaid', 'Unpaid'], ['unknown', 'Unknown'],
];

function fieldLabel(name: string): string {
  return name.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function ManagedCard({ row }: { row: ManagedOpportunity }) {
  const router = useRouter();
  const [draft, setDraft] = useState(row.draft);
  const [reason, setReason] = useState('');
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [publicSafeConfirmed, setPublicSafeConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = reason.trim().length >= 8 && sourceConfirmed && publicSafeConfirmed && !pending;

  const update = <K extends keyof OpportunityCorrectionDraft>(key: K, value: OpportunityCorrectionDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };
  const run = (operation: () => Promise<{ message: string }>) => startTransition(async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await operation();
      setMessage(result.message);
      setReason('');
      setSourceConfirmed(false);
      setPublicSafeConfirmed(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change could not be saved');
    }
  });

  return (
    <li className="manage-record">
      <header className="manage-record-header">
        <div>
          <p className="manage-company">{row.companyName}</p>
          <h2>{row.draft.title}</h2>
        </div>
        <span className={row.live ? 'manage-state manage-live' : 'manage-state manage-hidden'}>
          {row.live ? 'Live' : 'Off website'}
        </span>
      </header>
      <p className="review-muted">
        Updated {new Date(row.updatedAt).toLocaleString()} · {row.revisions.length} recorded change{row.revisions.length === 1 ? '' : 's'}
      </p>

      <details className="manage-editor" open={!row.live}>
        <summary>{row.live ? 'Edit this public record' : 'View record and restore history'}</summary>
        <div className="review-grid">
          <label className="review-field">Title
            <input value={draft.title} maxLength={300} onChange={(event) => update('title', event.target.value)} />
          </label>
          <label className="review-field">Official posting URL
            <input type="url" value={draft.postingUrl} onChange={(event) => update('postingUrl', event.target.value)} />
          </label>
          <label className="review-field">Location
            <input value={draft.location} onChange={(event) => update('location', event.target.value)} />
          </label>
          <label className="review-field">Focus area
            <input value={draft.focusArea} onChange={(event) => update('focusArea', event.target.value)} />
          </label>
          <label className="review-field">Deadline date
            <input type="date" value={draft.deadline} onChange={(event) => update('deadline', event.target.value)} />
          </label>
          <label className="review-field">Deadline note
            <input value={draft.deadlineText} placeholder="Rolling, ASAP, or other source wording" onChange={(event) => update('deadlineText', event.target.value)} />
          </label>
          <label className="review-field">Start date or duration
            <input value={draft.startDateText} onChange={(event) => update('startDateText', event.target.value)} />
          </label>
          <label className="review-field">Paid status
            <select value={draft.paidStatus} onChange={(event) => update('paidStatus', event.target.value as PaidStatus)}>
              {PAID.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="review-field">Application type
            <input value={draft.applicationType} onChange={(event) => update('applicationType', event.target.value)} />
          </label>
          <label className="review-field">Website status
            <select value={draft.status} onChange={(event) => update('status', event.target.value as OpportunityCorrectionDraft['status'])}>
              <option value="open_verified">Open and verified</option>
              <option value="open_unverified">Open, needs re-verification</option>
            </select>
          </label>
          <label className="review-field">Audience
            <select value={draft.audienceBucket} onChange={(event) => update('audienceBucket', event.target.value as AudienceBucket)}>
              {AUDIENCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="review-field">Master&apos;s stage
            <select value={draft.graduateStage} onChange={(event) => update('graduateStage', event.target.value as GraduateStage)}>
              {STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className="review-field">Eligibility
          <textarea rows={2} value={draft.eligibility} onChange={(event) => update('eligibility', event.target.value)} />
        </label>
        <label className="review-field">Evidence for the audience decision
          <textarea rows={2} value={draft.audienceReason} onChange={(event) => update('audienceReason', event.target.value)} />
        </label>
        <label className="review-field">Eligibility evidence
          <textarea rows={2} value={draft.eligibilityEvidence} onChange={(event) => update('eligibilityEvidence', event.target.value)} />
        </label>
        <label className="review-field">Work authorization
          <textarea rows={2} value={draft.workAuthorization} onChange={(event) => update('workAuthorization', event.target.value)} />
        </label>
        <label className="review-field">Public note
          <textarea rows={2} maxLength={500} value={draft.publicNotes} onChange={(event) => update('publicNotes', event.target.value)} />
        </label>
        <label className="review-field">Reason for this change
          <input value={reason} maxLength={500} placeholder="Required for save, removal, or restore" onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="review-checks">
          <label><input type="checkbox" checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.target.checked)} />
            <span>I checked {draft.postingUrl ? <a href={draft.postingUrl} target="_blank" rel="noopener noreferrer nofollow">the official posting</a> : 'an official source'}</span>
          </label>
          <label><input type="checkbox" checked={publicSafeConfirmed} onChange={(event) => setPublicSafeConfirmed(event.target.checked)} />
            <span>The corrected public fields contain no private information</span>
          </label>
        </div>
        <div className="manage-actions">
          {row.live && <button className="primary-button" disabled={!ready} onClick={() => run(() => saveOpportunityCorrection({
            id: row.id, expectedUpdatedAt: row.updatedAt, reason, sourceConfirmed, publicSafeConfirmed, draft,
          }))}>{pending ? 'Saving…' : 'Save correction'}</button>}
          {row.live && <button className="danger-button" disabled={reason.trim().length < 8 || pending} onClick={() => {
            if (window.confirm('Remove this opportunity from the public website now? You can restore it from history.')) {
              run(() => unpublishOpportunity({ id: row.id, expectedUpdatedAt: row.updatedAt, reason }));
            }
          }}>Remove from website</button>}
          <a className="secondary-button" href={draft.postingUrl || '/internships'} target={draft.postingUrl ? '_blank' : undefined} rel="noopener noreferrer">Open source</a>
        </div>
        {message && <p className="manage-success" role="status">{message}</p>}
        {error && <p className="review-error" role="alert">{error}</p>}
      </details>

      {row.revisions.length > 0 && <details className="manage-history">
        <summary>Change history and rollback</summary>
        <ol>
          {row.revisions.map((revision) => <li key={revision.id}>
            <div><strong>Revision {revision.revisionNumber}: {fieldLabel(revision.action)}</strong></div>
            <p>{revision.reason}</p>
            <p className="review-muted">{revision.changedBy} · {new Date(revision.createdAt).toLocaleString()}</p>
            {revision.changes.length > 0 && <p className="manage-change-list">Changed: {revision.changes.map(fieldLabel).join(', ')}</p>}
            <button className="secondary-button" disabled={!ready} onClick={() => run(() => restoreOpportunityRevision({
              id: row.id, revisionId: revision.id, expectedUpdatedAt: row.updatedAt, reason,
              sourceConfirmed, publicSafeConfirmed,
            }))}>Restore state before this change</button>
          </li>)}
        </ol>
      </details>}
    </li>
  );
}

export function OpportunityManager({ rows }: { rows: ManagedOpportunity[] }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return rows;
    return rows.filter((row) => `${row.companyName} ${row.draft.title} ${row.draft.location}`.toLowerCase().includes(search));
  }, [query, rows]);

  return <>
    <label className="filter-field manage-search">Find a published record
      <input type="search" value={query} placeholder="Company, title, or location" onChange={(event) => setQuery(event.target.value)} />
    </label>
    {filtered.length === 0
      ? <p style={{ color: 'var(--ink-soft)' }}>No matching approved records.</p>
      : <ul className="manage-records">{filtered.map((row) => <ManagedCard key={`${row.id}:${row.updatedAt}`} row={row} />)}</ul>}
  </>;
}
