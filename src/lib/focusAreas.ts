// Legacy display adapter. Classification keeps scientific subject, job function,
// and method separate. Older records still have one `focus_area` string, so the
// public filter uses scientific lane labels as its controlled suggestions while
// preserving any labels already stored in the database.

export const FOCUS_AREAS = [
  'Cancer and oncology',
  'Genomics and genetics',
  'Single-cell and spatial',
  'Bioinformatics and computational biology',
  'Biological data science and ML',
  'Diagnostics and clinical data',
  'Bioprocess and manufacturing science',
  'Protein science and drug discovery',
  'Neuroscience and neurodegeneration',
  'Immunology and infectious disease',
] as const;

/** Canonical list merged with whatever labels exist in current data. */
export function allFocusAreas(fromData: Array<string | null>): string[] {
  const set = new Set<string>(FOCUS_AREAS);
  for (const f of fromData) if (f) set.add(f);
  return [...set].sort();
}
