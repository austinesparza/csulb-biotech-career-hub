/** Bulk publication requires a recorded, recent positive employer-source check. */
export function hasRecentOpenSource(
  result: string | null,
  checkedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (result !== 'open' || !checkedAt) return false;
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked)) return false;
  const age = now.getTime() - checked;
  return age >= 0 && age <= 7 * 24 * 60 * 60 * 1000;
}
