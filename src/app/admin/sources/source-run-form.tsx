'use client';

import { useActionState } from 'react';
import { runSourceNow, type SourceRunActionState } from './actions';

const INITIAL_STATE: SourceRunActionState = { status: 'idle', message: '' };

export function SourceRunForm({ sourceId, disabled }: { sourceId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(runSourceNow, INITIAL_STATE);

  return <form action={action} className="space-y-2">
    <input type="hidden" name="id" value={sourceId} />
    <button className="primary-button" type="submit" disabled={disabled || pending}>
      {pending ? 'Running source…' : 'Run and archive now'}
    </button>
    {state.status !== 'idle' ? <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={`max-w-xs text-xs ${state.status === 'error' ? 'text-red-700' : 'text-emerald-800'}`}
    >
      {state.message}
    </p> : null}
  </form>;
}
