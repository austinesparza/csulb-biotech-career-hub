/** An official ATS board may impose an institution gate on all its roles. */
export const RESTRICTED_FLAGSHIP_COOP_BOARD = 'fspco-op012325';

export function sourceInstitutionRestriction(source: {
  source_kind: string;
  source_identifier: string | null;
  config_json?: Record<string, unknown> | null;
}): string | null {
  if (source.source_kind !== 'greenhouse') return null;
  if (source.source_identifier !== RESTRICTED_FLAGSHIP_COOP_BOARD
      && source.config_json?.boardToken !== RESTRICTED_FLAGSHIP_COOP_BOARD) return null;
  return 'The Flagship Pioneering Co-Op Program board is limited to current Northeastern University students. Keep this source disabled for the CSULB board.';
}
