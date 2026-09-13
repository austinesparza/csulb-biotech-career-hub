'use client';

import { useActionState } from 'react';
import {
  drainQueuedSourceRuns,
  initialQueueDrainActionState,
} from './queue-actions';

export function QueueDrainForm({ pendingCount }: { pendingCount: number }) {
  const [state, action, pending] = useActionState(drainQueuedSourceRuns, initialQueueDrainActionState);
  const tone = state.status === 'error'
    ? 'bg-red-50 text-red-800'
    : state.status === 'warning'
      ? 'bg-amber-50 text-amber-900'
      : 'bg-emerald-50 text-emerald-900';

  return <div className="mt-4">
    <form action={action}>
      <button className="secondary-button" type="submit" disabled={pending || pendingCount === 0}>
        {pending ? 'Processing queued runs…' : pendingCount > 0 ? 'Process queued runs now' : 'Queue is clear'}
      </button>
    </form>
    {state.status !== 'idle' ? <div
      role={state.status === 'error' ? 'alert' : 'status'}
      className={`mt-3 rounded p-3 text-sm ${tone}`}
    >
      <p>{state.message}</p>
      {typeof state.claimed === 'number' ? <p className="mt-1 text-xs">
        {state.claimed} claimed · {state.completed ?? 0} completed · {state.partial ?? 0} partial ·{' '}
        {state.failed ?? 0} failed · {state.repaired ?? 0} review bridge gaps repaired ·{' '}
        {state.sheetAdded ?? 0} Sheet rows added
      </p> : null}
    </div> : null}
  </div>;
}
