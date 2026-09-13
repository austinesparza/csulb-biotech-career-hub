export function SourceRunForm({ sourceId, disabled }: { sourceId: string; disabled: boolean }) {
  return <form action="/api/admin/sources/run" method="post" className="space-y-2">
    <input type="hidden" name="id" value={sourceId} />
    <button className="primary-button" type="submit" disabled={disabled}>
      Run and archive now
    </button>
  </form>;
}
