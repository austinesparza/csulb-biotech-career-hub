export interface GovernedStarterSource {
  id: string;
  sourceName: string;
  boardToken: string;
  careersUrl: string;
  fetchIntervalHours: number;
  verifiedAt: string;
  rationale: string;
}

/**
 * Small, manually verified starter cohort for the first production rollout.
 *
 * These are public employer-controlled Greenhouse boards with current science
 * internships or co-ops as of 2026-09-11. Adding one creates a disabled source.
 * An officer must still record policy review, run a private test, inspect the
 * result, and explicitly enable scheduling.
 */
export const GOVERNED_STARTER_SOURCES: readonly GovernedStarterSource[] = [
  {
    id: "xaira-therapeutics",
    sourceName: "Xaira Therapeutics",
    boardToken: "xairatherapeutics",
    careersUrl: "https://job-boards.greenhouse.io/xairatherapeutics",
    fetchIntervalHours: 24,
    verifiedAt: "2026-09-11",
    rationale: "Current computational protein-design internship for MS or PhD students.",
  },
  {
    id: "ginkgo-bioworks",
    sourceName: "Ginkgo Bioworks",
    boardToken: "ginkgobioworks",
    careersUrl: "https://job-boards.greenhouse.io/ginkgobioworks",
    fetchIntervalHours: 24,
    verifiedAt: "2026-09-11",
    rationale: "Current automation and autonomous-lab internship inventory.",
  },
  {
    id: "flagship-coop",
    sourceName: "Flagship Pioneering Co-Op Program",
    boardToken: "fspco-op012325",
    careersUrl: "https://job-boards.greenhouse.io/fspco-op012325",
    fetchIntervalHours: 24,
    verifiedAt: "2026-09-11",
    rationale: "Current genomics, proteomics, cell-biology, protein-science, and data-science co-ops.",
  },
] as const;

export const GREENHOUSE_POLICY_LINKS = {
  apiDocumentation: "https://docs.greenhouse.io/job-board.html#list-jobs",
  apiRobots: "https://boards-api.greenhouse.io/robots.txt",
  boardRobots: "https://job-boards.greenhouse.io/robots.txt",
} as const;

export function governedStarterSource(id: string): GovernedStarterSource | null {
  return GOVERNED_STARTER_SOURCES.find((source) => source.id === id) ?? null;
}
