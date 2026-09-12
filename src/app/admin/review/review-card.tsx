'use client';

import { useMemo, useState, useTransition } from 'react';
import type { Classification } from '@/lib/pipeline/classify';
import { PRIORITY_FIELDS } from '@/lib/pipeline/extraction-schema';
import { segment, type Span } from '@/lib/pipeline/highlight';
import type { AudienceBucket, GraduateStage, PaidStatus } from '@/lib/types';
import type { SheetReviewIntent } from '@/lib/sheet-review';
import { approveOpportunity, archiveForAudience, rejectOpportunity } from './actions';

interface ExtractedField {
  value: string;
  quote: string | null;
}

interface BoundField extends ExtractedField {
  start: number | null;
  end: number | null;
  ok: boolean;
  reason?: string;
}

export interface ReviewExtraction {
  id: string;
  created_at: string;
  evidence_ok: boolean;
  binding_failures: string[];
  injection_flags: string[];
  classification: Partial<Classification>;
  fields: Record<string, ExtractedField>;
  bindings: Record<string, BoundField>;
  raw_text: string | null;
}

export interface ReviewRow {
  id: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  start_date_text: string | null;
  paid_status: PaidStatus;
  application_type: string | null;
  source_status_raw: string | null;
  public_notes: string | null;
  private_notes: string | null;
  relevance_score: number | null;
  relevance_reasons: string[];
  audience_bucket: AudienceBucket;
  audience_reason: string | null;
  graduate_stage: GraduateStage;
  scientific_lanes: string[];
  job_functions: string[];
  methods: string[];
  companies: { name: string; public_safe: boolean } | null;
  extraction: ReviewExtraction | null;
  sheet_review: SheetReviewIntent | null;
}

const AUDIENCE_OPTIONS: Array<{ value: AudienceBucket; label: string }> = [
  { value: 'unknown', label: 'Not decided' },
  { value: 'graduate', label: "Master's accessible" },
  { value: 'mixed', label: "Master's and undergraduate" },
  { value: 'special', label: 'Special affiliation required' },
  { value: 'adjacent', label: 'Adjacent term or format' },
  { value: 'ineligible', label: "Not accessible to master's students" },
];

const STAGE_OPTIONS: Array<{ value: GraduateStage; label: string }> = [
  { value: 'unknown', label: 'Not stated' },
  { value: 'msc_year_1', label: "First-year master's" },
  { value: 'msc_year_2', label: "Second-year master's" },
  { value: 'msc_any', label: "Any master's year" },
  { value: 'mixed_graduate', label: "Master's and doctoral" },
  { value: 'graduate_unspecified', label: 'Graduate, year not stated' },
  { value: 'doctoral_only', label: 'Doctoral only' },
  { value: 'not_msc', label: "Not master's accessible" },
];

const PUBLISHABLE_STAGES = new Set<GraduateStage>([
  'msc_year_1', 'msc_year_2', 'msc_any', 'mixed_graduate', 'graduate_unspecified',
]);

const FIELD_LABELS: Record<string, string> = {
  masters_eligibility: "Master's eligibility",
  enrollment_rule: 'Enrollment',
  return_rule: 'Return to school',
  work_authorization: 'Work authorization',
  deadline: 'Deadline',
  pay_range: 'Pay',
  gpa_requirement: 'GPA',
  degree_fields: 'Degree fields',
  application_steps: 'Application steps',
  schedule_format: 'Schedule',
};

function EvidencePanel({ extraction }: { extraction: ReviewExtraction }) {
  const displayed = PRIORITY_FIELDS
    .map((name) => [name, extraction.fields[name]] as const)
    .filter(([, field]) => field && field.value.trim() !== 'Unknown');

  const highlighted = useMemo(() => {
    if (!extraction.raw_text) return null;
    const spans: Span[] = Object.entries(extraction.bindings)
      .filter(([, binding]) => binding.ok && binding.start !== null && binding.end !== null)
      .map(([field, binding]) => ({ field, start: binding.start!, end: binding.end! }));
    return segment(extraction.raw_text, spans);
  }, [extraction]);

  const methodSignals = Object.values(extraction.classification.methods ?? {}).flat();
  const structuralGateSignals = (extraction.classification.structuralGates ?? [])
    .map((gate) => gate.id.replaceAll('_', ' '));
  const classifierSignals = [
    ...(extraction.classification.lanes ?? []).map((lane) => lane.label),
    ...(extraction.classification.functions ?? []).map((jobFunction) => jobFunction.label),
    ...methodSignals,
    ...structuralGateSignals,
  ];

  return (
    <details className="review-evidence">
      <summary>
        Extracted facts
        <span className={extraction.evidence_ok ? 'evidence-ok' : 'evidence-check'}>
          {extraction.evidence_ok ? 'quotes found' : 'check quotes'}
        </span>
      </summary>

      {extraction.injection_flags.length > 0 && (
        <p className="evidence-warning">
          Source text contains instruction-like language. Read the source before using any extracted value.
        </p>
      )}

      <p className="review-muted">
        <strong>Classifier:</strong>{' '}
        {classifierSignals.length > 0 ? classifierSignals.join(' · ') : 'no scientific signal recorded'}
        {' · '}stage: {(extraction.classification.stage?.label ?? 'not stated').toLowerCase()}
        {' · '}suggested bucket: {(extraction.classification.suggestedBucket ?? 'not decided').replaceAll('_', ' ')}
      </p>

      {displayed.length > 0 ? (
        <dl className="evidence-fields">
          {displayed.map(([name, field]) => {
            const binding = extraction.bindings[name];
            return (
              <div key={name}>
                <dt>{FIELD_LABELS[name] ?? name.replaceAll('_', ' ')}</dt>
                <dd>{field.value}</dd>
                <dd className="evidence-quote">
                  {binding?.ok && field.quote ? `“${field.quote}”` : 'No usable source quote'}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="review-muted">No asserted priority fields in this extraction.</p>
      )}

      {highlighted && (
        <details className="source-text">
          <summary>Read source text</summary>
          <p>
            {highlighted.segments.map((part, index) => part.fields.length > 0
              ? <mark key={index}>{part.text}</mark>
              : <span key={index}>{part.text}</span>)}
          </p>
        </details>
      )}
    </details>
  );
}

export function ReviewCard({ row }: { row: ReviewRow }) {
  const sheetApproval = row.sheet_review?.decision === 'approve'
    && row.sheet_review.publicSafe
    && Boolean(row.posting_url);
  const initialAudience = row.audience_bucket !== 'unknown'
    ? row.audience_bucket
    : row.sheet_review?.audienceBucket ?? 'unknown';
  const initialStage = row.graduate_stage !== 'unknown'
    ? row.graduate_stage
    : row.sheet_review?.graduateStage ?? 'unknown';
  const initialReason = row.audience_reason?.trim()
    ? row.audience_reason
    : row.sheet_review?.audienceReason ?? '';
  const [sourceConfirmed, setSourceConfirmed] = useState(sheetApproval);
  const [publicSafeConfirmed, setPublicSafeConfirmed] = useState(sheetApproval);
  const [status, setStatus] = useState<'open_verified' | 'open_unverified'>('open_verified');
  const [publicNotes, setPublicNotes] = useState(row.public_notes ?? '');
  const [audienceBucket, setAudienceBucket] = useState<AudienceBucket>(initialAudience);
  const [audienceReason, setAudienceReason] = useState(initialReason);
  const [graduateStage, setGraduateStage] = useState<GraduateStage>(initialStage);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const finalFields = useMemo(() => {
    const classification = row.extraction?.classification;
    const scientificLanes = (classification?.lanes ?? [])
      .map((lane) => lane.label.trim())
      .filter(Boolean);
    const jobFunctions = (classification?.functions ?? [])
      .map((jobFunction) => jobFunction.label.trim())
      .filter(Boolean);
    const methods = Object.values(classification?.methods ?? {})
      .flat()
      .map((method) => method.trim())
      .filter(Boolean);
    const unique = (values: string[]) => [...new Set(values)];

    return {
      scientificLanes: unique(scientificLanes.length > 0 ? scientificLanes : row.scientific_lanes),
      jobFunctions: unique(jobFunctions.length > 0 ? jobFunctions : row.job_functions),
      methods: unique(methods.length > 0 ? methods : row.methods),
    };
  }, [row]);

  const audienceReady = audienceBucket !== 'unknown' && audienceReason.trim().length >= 8;
  const canApprove = sourceConfirmed && publicSafeConfirmed && audienceReady
    && ['graduate', 'mixed'].includes(audienceBucket)
    && PUBLISHABLE_STAGES.has(graduateStage) && !pending;
  const canArchive = sourceConfirmed && publicSafeConfirmed && audienceReady
    && ['ineligible', 'adjacent', 'special'].includes(audienceBucket) && !pending;
  const sheetApprovalReady = sheetApproval
    && ['graduate', 'mixed'].includes(initialAudience)
    && PUBLISHABLE_STAGES.has(initialStage)
    && initialReason.trim().length >= 8;

  if (done) {
    return <li className="review-record review-record-done"><span>{row.title}</span> · {done}</li>;
  }

  const meta = [
    row.location, row.focus_area, row.eligibility,
    row.deadline ? `deadline ${row.deadline}` : row.deadline_text,
    row.start_date_text, row.paid_status, row.application_type,
  ].filter(Boolean).join(' · ');

  return (
    <li className="review-record">
      <header className="review-record-header">
        <h2>{row.title} <span>· {row.companies?.name ?? 'Unknown company'}</span></h2>
        {row.relevance_score != null && <span className="review-score">score {row.relevance_score}</span>}
      </header>

      <p className="review-muted">{meta}</p>
      {row.extraction && <EvidencePanel extraction={row.extraction} />}

      {row.sheet_review?.decision && (
        <p className="sheet-review-status">
          <strong>Spreadsheet review:</strong> {row.sheet_review.decision === 'approve' ? 'Approve' : 'Reject'}
          {' · '}public-safe {row.sheet_review.publicSafe ? 'checked' : 'not checked'}
          {row.sheet_review.reviewer ? ` · ${row.sheet_review.reviewer}` : ''}
        </p>
      )}

      {row.private_notes && (
        <details className="review-private">
          <summary>Spreadsheet notes and evidence</summary>
          <p>{row.private_notes}</p>
        </details>
      )}

      <details className="review-form" open={!sheetApprovalReady}>
        <summary>{sheetApprovalReady ? 'Review or change imported details' : 'Complete review details'}</summary>
        <label className="review-field">
          Public note
          <textarea value={publicNotes} onChange={(event) => setPublicNotes(event.target.value)} rows={2} maxLength={500}
            placeholder="Optional. Keep it factual and student-safe." />
        </label>

        <div className="review-grid">
          <label className="review-field">
            Audience
            <select value={audienceBucket} onChange={(event) => setAudienceBucket(event.target.value as AudienceBucket)}>
              {AUDIENCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="review-field">
            Master&apos;s stage
            <select value={graduateStage} onChange={(event) => setGraduateStage(event.target.value as GraduateStage)}>
              {STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        <label className="review-field">
          Evidence for the audience decision
          <input value={audienceReason} onChange={(event) => setAudienceReason(event.target.value)} maxLength={300}
            placeholder="Example: Posting accepts students currently enrolled in a master's program." />
        </label>

        <div className="review-checks">
          <label>
            <input type="checkbox" checked={sourceConfirmed} onChange={(event) => setSourceConfirmed(event.target.checked)} />
            <span>I checked {row.posting_url ? (
              <a href={row.posting_url} target="_blank" rel="noopener noreferrer nofollow" onClick={() => setSourceConfirmed(true)}>the official posting</a>
            ) : 'an official source'} and it matches this record</span>
          </label>
          <label>
            <input type="checkbox" checked={publicSafeConfirmed} onChange={(event) => setPublicSafeConfirmed(event.target.checked)} />
            <span>Public fields contain no private information</span>
          </label>
        </div>
      </details>

      <div className="review-actions">
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="open_verified">Publish as verified</option>
          <option value="open_unverified">Publish as not yet re-verified</option>
        </select>
        <button disabled={!canApprove} onClick={() => startTransition(async () => {
          setError(null);
          try {
            const result = await approveOpportunity({
              id: row.id, status, publicNotes, makeCompanyPublic: !(row.companies?.public_safe ?? false),
              audienceBucket, audienceReason, graduateStage, finalFields, sourceConfirmed, publicSafeConfirmed,
            });
            if (!result.ok) { setError(result.error); return; }
            setDone('approved and published');
          } catch (caught) { setError(caught instanceof Error ? caught.message : 'Approval failed'); }
        })}>{pending ? 'Saving…' : sheetApprovalReady ? 'Confirm Sheet approval and publish' : 'Approve'}</button>
        <button disabled={!canArchive} onClick={() => startTransition(async () => {
          setError(null);
          try {
            const result = await archiveForAudience({
              id: row.id, audienceBucket: audienceBucket as 'ineligible' | 'adjacent' | 'special',
              audienceReason, graduateStage, sourceConfirmed, publicSafeConfirmed,
            });
            if (!result.ok) { setError(result.error); return; }
            setDone('kept outside the public board');
          } catch (caught) { setError(caught instanceof Error ? caught.message : 'Archive failed'); }
        })}>Keep outside board</button>
        <button disabled={pending} onClick={() => startTransition(async () => {
          setError(null);
          try {
            const result = await rejectOpportunity(row.id, 'not_relevant');
            if (!result.ok) { setError(result.error); return; }
            setDone('rejected as not relevant');
          }
          catch (caught) { setError(caught instanceof Error ? caught.message : 'Rejection failed'); }
        })}>Not relevant</button>
        <button disabled={pending} onClick={() => startTransition(async () => {
          setError(null);
          try {
            const result = await rejectOpportunity(row.id, 'hidden');
            if (!result.ok) { setError(result.error); return; }
            setDone('hidden');
          }
          catch (caught) { setError(caught instanceof Error ? caught.message : 'Hide failed'); }
        })}>Hide</button>
      </div>

      {error && <p className="review-error">{error}</p>}
    </li>
  );
}
