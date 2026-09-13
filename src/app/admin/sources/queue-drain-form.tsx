export function QueueDrainForm({ pendingCount }: { pendingCount: number }) {
  return <div className="mt-4">
    <form action="/api/admin/pipeline/queue" method="post">
      <button className="secondary-button" type="submit" disabled={pendingCount === 0}>
        {pendingCount > 0 ? 'Process queued runs now' : 'Queue is clear'}
      </button>
    </form>
    <p className="mt-3 text-xs" style={{ color: 'var(--ink-soft)' }}>
      Queue-only recovery uses a normal authenticated POST so it remains usable when browser Server Actions are interrupted. It does not schedule additional sources.
    </p>
  </div>;
}
