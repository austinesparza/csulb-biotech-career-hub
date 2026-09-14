'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveSheetPublishCandidate } from '@/lib/review-publish';
import { ReviewCard, type ReviewRow } from './review-card';
import {
  syncAndPublishReviewedOpportunities,
  type ReviewedPublishSummary,
} from './bulk-actions';

export type { ReviewRow } from './review-card';

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

  const readyNow = readiness.filter((item) => item.resolution.ready).length;
  const sheetApprovedButBlocked = readiness.filter((item) => (
    item.row.sheet_review?.decision === 'approve' && !item.resolution.ready
  )).length;
  const outsideBoard = rows.filter((row) => ['special', 'adjacent', 'ineligible'].includes(row.audience_bucket)).length;

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
          <div><strong>{readyNow}</strong><span>ready from Sheet</span></div>
          <div><strong>{sheetApprovedButBlocked}</strong><span>approved but blocked</span></div>
          <div><strong>{outsideBoard}</strong><span>outside-board audience</span></div>
        </div>

        <div className="review-publish-action">
          <div>
            <strong>Normal officer workflow</strong>
            <p>
              This reads the latest Sheet decisions, publishes only valid Approve + Public Safe rows,
              then refreshes the Sheet so resolved rows move to Archive. No CSV export, Git commit, or site redeploy is required.
            </p>
          </div>
          <button type="button" className="primary-button" disabled={pending} onClick={runReviewedPublish}>
            {pending ? 'Syncing and publishing…' : 'Sync Sheet + publish reviewed'}
          </button>
        </div>

        {readyNow === 0 && rows.length > 0 ? (
          <p className="review-publish-note">
            Nothing in the currently loaded queue is ready for bulk publication yet. The sync can still pull newer Sheet decisions.
            Special-affiliation, adjacent, and ineligible roles will remain private by design.
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
        <ul className="review-records">
          {rows.map((row) => <ReviewCard key={row.id} row={row} />)}
        </ul>
      )}
    </>
  );
}
