'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveSheetPublishCandidate } from '@/lib/review-publish';
import { reviewReadinessBucket } from '@/lib/review-readiness';
import { ReviewCard, type ReviewRow } from './review-card';
import {
  syncAndPublishReviewedOpportunities,
  type ReviewedPublishSummary,
} from './bulk-actions';

export type { ReviewRow } from './review-card';

interface ReviewGroup {
  key: 'decision-ready' | 'needs-confirmation' | 'outside-board';
  title: string;
  description: string;
  rows: ReviewRow[];
}

function bucketFor(row: ReviewRow) {
  return reviewReadinessBucket({
    postingUrl: row.posting_url,
    audienceBucket: row.audience_bucket,
    audienceReason: row.audience_reason,
    graduateStage: row.graduate_stage,
  });
}

export function ReviewList({ rows }: { rows: ReviewRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<ReviewedPublishSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readiness = useMemo(() => rows.map((row) => ({
    row,
    resolution: resolveSheetPublishCandidate({
      postingUrl: row.posting_url,
      audienceBucket: row.audience_bucket,
      audienceReason: row.audience_reason,
      graduateStage: row.graduate_stage,
      sheetReview: row.sheet_review,
    }),
  })), [rows]);

  const groupedRows = useMemo(() => {
    const grouped = {
      'decision-ready': [] as ReviewRow[],
      'needs-confirmation': [] as ReviewRow[],
      'outside-board': [] as ReviewRow[],
    };
    for (const row of rows) grouped[bucketFor(row)].push(row);
    return grouped;
  }, [rows]);

  const decisionReady = groupedRows['decision-ready'];
  const needsConfirmation = groupedRows['needs-confirmation'];
  const outsideBoardRows = groupedRows['outside-board'];

  const groups: ReviewGroup[] = useMemo(() => [
    {
      key: 'decision-ready',
      title: 'Ready for officer decision',
      description: 'Official source and student-audience fields are structured. Review the posting, then approve or reject.',
      rows: decisionReady,
    },
    {
      key: 'needs-confirmation',
      title: 'Needs eligibility confirmation',
      description: 'These records still need an audience, degree-level, or evidence decision before they can publish.',
      rows: needsConfirmation,
    },
    {
      key: 'outside-board',
      title: 'Outside the public student board',
      description: 'Special-affiliation, adjacent, or ineligible records stay private unless their classification is corrected.',
      rows: outsideBoardRows,
    },
  ], [decisionReady, needsConfirmation, outsideBoardRows]);

  const readyNow = readiness.filter((item) => item.resolution.ready).length;
  const sheetApprovedButBlocked = readiness.filter((item) => (
    item.row.sheet_review?.decision === 'approve' && !item.resolution.ready
  )).length;

  function runReviewedPublish() {
    const confirmed = window.confirm(
      'This will import the latest Review Queue decisions and publish every pending row marked Approve + Public Safe that passes the student-audience guardrails. Continue?',
    );
    if (!confirmed) return;

    setError(null);
    setSummary(null);
    startTransition(async () => {
      try {
        const result = await syncAndPublishReviewedOpportunities();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSummary(result.summary);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error
          ? caught.message
          : 'The reviewed-publication workflow could not reach the server.');
      }
    });
  }

  return (
    <>
      <section className="review-publish-console" aria-labelledby="review-publish-title">
        <div className="review-publish-copy">
          <div className="admin-page-eyebrow">Scrape to site</div>
          <h2 id="review-publish-title">Finish reviewed findings in one place</h2>
          <p>
            A scrape count is not a publication count. Machine findings stay private until they become a candidate,
            receive an officer decision, and pass the public-safety and student-audience gates.
          </p>
        </div>

        <div className="review-publish-stats" aria-label="Publication queue status">
          <div><strong>{rows.length}</strong><span>pending candidates</span></div>
          <div><strong>{decisionReady.length}</strong><span>decision-ready</span></div>
          <div><strong>{readyNow}</strong><span>ready to publish</span></div>
          <div><strong>{needsConfirmation.length}</strong><span>needs confirmation</span></div>
        </div>

        <div className="review-publish-action">
          <div>
            <strong>Normal officer workflow</strong>
            <p>
              Work through the decision-ready group first. In the Sheet, choose Approve or Reject and check Public Safe only after review.
              Then this action reads those decisions, publishes valid approvals, and moves resolved rows to Archive.
            </p>
          </div>
          <button type="button" className="primary-button" disabled={pending} onClick={runReviewedPublish}>
            {pending ? 'Syncing and publishing…' : 'Sync Sheet + publish reviewed'}
          </button>
        </div>

        {readyNow === 0 && rows.length > 0 ? (
          <p className="review-publish-note">
            No Sheet-approved records are ready to publish yet. {decisionReady.length > 0
              ? `${decisionReady.length} candidate${decisionReady.length === 1 ? ' is' : 's are'} already structured for an officer decision.`
              : 'Resolve the eligibility-confirmation group first.'}
          </p>
        ) : null}

        {sheetApprovedButBlocked > 0 ? (
          <p className="review-publish-note">
            {sheetApprovedButBlocked} Sheet-approved candidate{sheetApprovedButBlocked === 1 ? ' is' : 's are'} blocked by final guardrails and will remain private.
          </p>
        ) : null}

        {summary ? (
          <div className="review-publish-result" role="status">
            <strong>{summary.published} published</strong>
            <span>
              {summary.sheetApproved} Sheet-approved candidate{summary.sheetApproved === 1 ? '' : 's'} evaluated ·{' '}
              {summary.blocked.length} blocked by final guardrails · {summary.pendingCandidates} pending candidates inspected
            </span>
            {summary.blocked.length > 0 ? (
              <details>
                <summary>Show blocked reviewed rows</summary>
                <ul>
                  {summary.blocked.slice(0, 10).map((item) => (
                    <li key={item.id}><strong>{item.title}</strong>: {item.reason}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {summary.sheetArchiveWarning ? <p>{summary.sheetArchiveWarning}</p> : null}
          </div>
        ) : null}

        {error ? <p className="review-publish-error" role="alert">{error}</p> : null}
      </section>

      {rows.length === 0 ? (
        <p style={{ color: 'var(--ink-soft)' }}>
          Queue is clear. Reviewed records are either published, archived, or waiting for a future source update.
        </p>
      ) : (
        <div className="review-groups">
          {groups.filter((group) => group.rows.length > 0).map((group) => (
            <section key={group.key} className={`review-group review-group-${group.key}`}>
              <header className="review-group-head">
                <div>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
                <span>{group.rows.length}</span>
              </header>
              <ul className="review-records">
                {group.rows.map((row) => <ReviewCard key={row.id} row={row} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
