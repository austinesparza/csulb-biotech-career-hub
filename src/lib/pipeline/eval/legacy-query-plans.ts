/**
 * legacy-query-plans.ts — FROZEN copy of the query builders at PR #123's head
 * (710634e, src/lib/pipeline/search-plan.ts). Used only as the "before" arm of
 * the fixed-set evaluation. Do not import from production code.
 */
import type { Taxonomy } from "../classify";
import { atsSearchClause } from "../ats-hosts";
import type { DiscoveryRoute, EmployerSearchPlan, LaneSearchPlan } from "../search-plan";

const OPPORTUNITY_TERMS = [
  "intern",
  "internship",
  "student intern",
  "graduate intern",
  "graduate internship",
  "master's intern",
  "MSc intern",
  "research intern",
  "co-op",
  "research co-op",
  "summer scholar",
];

const LANE_OPPORTUNITY_TERMS = [
  "intern",
  "internship",
  "research intern",
  "co-op",
  "research co-op",
  "graduate intern",
  "master's intern",
  "summer scholar",
];

const ELIGIBILITY_TERMS = [
  "undergraduate student",
  "bachelor's student",
  "master's student",
  "graduate student",
  "doctoral student",
  "PhD student",
  "currently enrolled",
  "return to school",
  "expected graduation",
];

const BROAD_PROGRAM_TERMS = [
  ...OPPORTUNITY_TERMS,
  "technology intern",
  "technology co-op",
  "data science intern",
  "research and development intern",
  "career programs",
  "student programs",
];

function quotedOr(terms: string[]): string {
  return terms.map((term) => `"${term}"`).join(" OR ");
}

/**
 * Builds small, auditable search families for every enabled scientific lane.
 * Search results are leads. They are archived even when they cannot be resolved
 * or do not belong on the graduate public board.
 */
export function legacyLaneSearchPlans(taxonomy: Taxonomy, cycleYear: number): LaneSearchPlan[] {
  if (!Number.isInteger(cycleYear) || cycleYear < 2020 || cycleYear > 2100) {
    throw new Error("cycleYear must be a four-digit year");
  }
  return taxonomy.lanes.map((lane) => {
    const science = [...lane.core.slice(0, 6), ...(lane.supporting ?? []).slice(0, 4)];
    const compactScience = quotedOr(science.slice(0, 4));
    const compactOpportunity = quotedOr(LANE_OPPORTUNITY_TERMS);
    const eligibility = quotedOr(ELIGIBILITY_TERMS.slice(0, 7));
    return {
      lane: lane.id,
      label: lane.label,
      keywords: science,
      queries: [
        {
          route: "official_feed",
          query: `(${compactScience}) (${compactOpportunity})`,
        },
        {
          route: "web_search",
          query: `(${compactScience}) (${compactOpportunity}) (${cycleYear} OR summer) (${eligibility})`,
        },
        {
          route: "web_search",
          query: `(${atsSearchClause()}) (${compactScience}) (intern OR co-op)`,
        },
        {
          route: "linkedin_lead",
          query: `site:linkedin.com/jobs/view (${compactScience}) (intern OR co-op) (master's OR graduate)`,
        },
        {
          route: "linkedin_lead",
          query: `site:linkedin.com/posts (${compactScience}) (internship OR hiring) ${cycleYear}`,
        },
      ],
    };
  });
}

/**
 * Complements lane searches by inventorying student programs at a known employer.
 * This catches generic titles such as "Technology Co-Op" that carry little or no
 * scientific vocabulary in the search result. Every result is still archived
 * and classified after retrieval.
 */
export function legacyEmployerSearchPlan(input: {
  employer: string;
  cycleYear: number;
  careersDomain?: string | null;
  programTerms?: string[];
}): EmployerSearchPlan {
  const employer = input.employer.trim();
  if (!employer) throw new Error("employer is required");
  if (!Number.isInteger(input.cycleYear) || input.cycleYear < 2020 || input.cycleYear > 2100) {
    throw new Error("cycleYear must be a four-digit year");
  }
  const domain = input.careersDomain?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) throw new Error("careersDomain must be a hostname");
  const namedEmployer = `"${employer.replaceAll('"', "")}"`;
  const programs = quotedOr(BROAD_PROGRAM_TERMS);
  const historicalPrograms = (input.programTerms ?? [])
    .map((term) => term.trim().replaceAll('"', ''))
    .filter(Boolean)
    .slice(0, 4);
  const historicalClause = historicalPrograms.length > 0 ? ` OR ${quotedOr(historicalPrograms)}` : '';
  const eligibility = quotedOr(ELIGIBILITY_TERMS);
  const scoped = domain ? `site:${domain} ` : "";
  return {
    employer,
    careersDomain: domain,
    queries: [
      {
        route: "employer_page",
        query: `${scoped}(${programs}${historicalClause}) (${input.cycleYear} OR summer OR spring OR fall)`,
      },
      {
        route: "web_search",
        query: `${namedEmployer} (${programs}${historicalClause})`,
      },
      {
        route: "web_search",
        query: `${namedEmployer} (intern OR internship OR co-op) (${eligibility})`,
      },
      {
        route: "linkedin_lead",
        query: `site:linkedin.com/jobs/view ${namedEmployer} (intern OR internship OR co-op)`,
      },
      {
        route: "linkedin_lead",
        query: `site:linkedin.com/posts ${namedEmployer} (internship OR co-op OR hiring) ${input.cycleYear}`,
      },
    ],
  };
}

