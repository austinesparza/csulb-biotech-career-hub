// Canonical focus areas: career categories the club tracks. Used to populate
// the board filter, the personal-tuning checkboxes, and quick-add suggestions.
// Officers extend this list here; data with other labels still works (matching
// is substring-based), it just won't appear as a preset option.

export const FOCUS_AREAS = [
  'Research & Development',
  'Quality Assurance',
  'Quality Control',
  'Manufacturing & Operations',
  'Process Development',
  'Regulatory Affairs',
  'Clinical Research',
  'Data Science & Informatics',
  'Software & Engineering',
  'Business Development',
  'Marketing & Sales',
  'Science Communication',
  'Supply Chain & Logistics',
  'Project Management',
  'Legal & Intellectual Property',
  'Finance & Consulting',
  'Environmental & Sustainability',
  'Education & Outreach',
] as const;

/** Canonical list merged with whatever labels exist in current data. */
export function allFocusAreas(fromData: Array<string | null>): string[] {
  const set = new Set<string>(FOCUS_AREAS);
  for (const f of fromData) if (f) set.add(f);
  return [...set].sort();
}
