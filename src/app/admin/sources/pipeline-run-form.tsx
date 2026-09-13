'use client';

import { useActionState } from 'react';
import {
  initialPipelineRunActionState,
  runFullPipelineNow,
} from './pipeline-actions';

export function PipelineRunForm() {
  const [state, action, pending] = useActionState(runFullPipelineNow, initialPipelineRunActionState);
  const tone = state.status === 'error'
    ? 'text-red-800 bg-red-50'
    : state.status === 'warning'
      ? 'text-amber-900 bg-amber-50'
      : 'text-emerald-900 bg-emerald-50';

  return <div className="mt-4 space-y-3">
    <form action={action}>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? 'Running pipeline…' : 'Run pipeline now'}
      </button>
    </form>
    {state.status !== 'idle' ? <div
      role={state.status === 'error' ? 'alert' : 'status'}
      className={`rounded-lg p-3 text-sm ${tone}`}
    >
      <p className="font-semibold">{state.message}</p>
      {typeof state.claimed === 'number' ? <p className="mt-1 text-xs">
        {state.scheduled ?? 0} due scheduled · {state.recovered ?? 0} stale recovered ·{' '}
        {state.claimed} runs processed · {state.completed ?? 0} completed · {state.partial ?? 0} partial ·{' '}
        {state.failed ?? 0} failed · {state.recordsSeen ?? 0} postings observed · {state.repaired ?? 0} bridge gaps repaired ·{' '}
        {state.sheetAdded ?? 0} Sheet rows added · {state.stageErrors ?? 0} stage warnings/errors
      </p> : null}
      {state.cycleId ? <p className="mt-1 text-[11px] opacity-75">Cycle {state.cycleId}</p> : null}
    </div> : null}
  </div>;
}
