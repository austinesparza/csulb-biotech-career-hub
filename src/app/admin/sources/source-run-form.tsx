export function SourceRunForm({ sourceId, disabled }: { sourceId: string; disabled: boolean }) {
  return <div className="space-y-2">
    <form action="/api/admin/sources/run" method="post">
      <input type="hidden" name="id" value={sourceId} />
      <button className="primary-button" type="submit" disabled={disabled}>
        Run and archive now
      </button>
    </form>
    <p className="max-w-xs text-xs" style={{ color: 'var(--ink-soft)' }}>
      Uses the authenticated source-run endpoint and returns here after the archive and optional Sheet sync finish.
    </p>
  </div>;
}
