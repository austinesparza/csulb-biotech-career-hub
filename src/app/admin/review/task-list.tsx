import type { ReviewTask } from '@/lib/types';
import { resolveReviewTask } from './actions';

export function TaskList({ rows }: { rows: ReviewTask[] }) {
  if (!rows.length) return <p>No open review tasks.</p>;
  return <ul className="review-records">{rows.map((row) => (
    <li key={row.id} className="review-record">
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{row.task_type.replaceAll('_', ' ')}</strong>
        <span className="text-sm">{new Date(row.created_at).toLocaleDateString()}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{row.notes ?? 'No task note.'}</p>
      <p className="mt-2 text-xs">{row.entity_table} · {row.entity_id}</p>
      <form action={resolveReviewTask} className="mt-3 flex gap-2">
        <input type="hidden" name="id" value={row.id} />
        <button className="secondary-button" name="status" value="done">Done</button>
        <button className="secondary-button" name="status" value="dismissed">Dismiss</button>
      </form>
    </li>
  ))}</ul>;
}
