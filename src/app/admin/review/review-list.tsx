'use client';

import { ReviewCard, type ReviewRow } from './review-card';

export type { ReviewRow } from './review-card';

export function ReviewList({ rows }: { rows: ReviewRow[] }) {
  if (rows.length === 0) {
    return (
      <p style={{ color: 'var(--ink-soft)' }}>
        Queue is clear. Import a CSV or check back after the next submission.
      </p>
    );
  }

  return (
    <ul className="review-records">
      {rows.map((row) => <ReviewCard key={row.id} row={row} />)}
    </ul>
  );
}
