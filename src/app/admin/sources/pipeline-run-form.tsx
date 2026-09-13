export function PipelineRunForm() {
  return <div className="mt-4 space-y-3">
    <form action="/api/admin/pipeline/run" method="post">
      <button className="primary-button" type="submit">
        Run pipeline now
      </button>
    </form>
    <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>
      Runs through a normal authenticated POST and returns here when the cycle finishes. This avoids relying on the browser&apos;s Server Action transport for a long-running operational task.
    </p>
  </div>;
}
