import type { Taxonomy } from "./classify";
import { ATS_SEARCH_HOSTS, METHOD_TERMS, employerQueryFamilies, methodQueryFamilies, withinLimits } from "./query-families";

export type DiscoveryRoute = "official_feed" | "employer_page" | "web_search" | "linkedin_lead";

export interface LaneSearchPlan {
  lane: string;
  label: string;
  keywords: string[];
  queries: Array<{ route: DiscoveryRoute; query: string }>;
}

export interface EmployerSearchPlan {
  employer: string;
  careersDomain: string | null;
  queries: Array<{ route: DiscoveryRoute; query: string }>;
}

/**
 * Builds small, auditable search families for every enabled scientific lane.
 * Search results are leads. They are archived even when they cannot be resolved
 * or do not belong on the graduate public board.
 *
 * Each lane searches its whole-word method phrases (query-families.ts) with
 * no mandatory year, season or degree term, across one ATS host per query and
 * LinkedIn job pages. The previous grouped form required a scientific stem,
 * an opportunity term, "2027 OR summer" and an eligibility phrase together,
 * which cannot match generic or off-cycle titles.
 */
export function buildLaneSearchPlans(taxonomy: Taxonomy, cycleYear: number): LaneSearchPlan[] {
  if (!Number.isInteger(cycleYear) || cycleYear < 2020 || cycleYear > 2100) {
    throw new Error("cycleYear must be a four-digit year");
  }
  return taxonomy.lanes.map((lane) => {
    const curated = METHOD_TERMS.filter((method) => method.lane === lane.id).map((method) => method.term);
    // Fall back to whole-word core terms; stems such as "oncolog" never match a quoted search.
    const fallback = lane.core.filter((term) => term.length > 3 && /^[a-z0-9 -]+$/i.test(term)
      && lane.core.every((other) => other === term || !other.startsWith(term)));
    const methods = (curated.length ? curated : fallback).slice(0, 6);
    const queries: Array<{ route: DiscoveryRoute; query: string }> = [];
    methods.forEach((term, index) => {
      const [roles, , linkedin] = methodQueryFamilies({ term, lane: lane.id, atsHost: ATS_SEARCH_HOSTS[0] });
      queries.push({ route: roles.route, query: roles.query });
      if (index === 0 && linkedin) queries.push({ route: linkedin.route, query: linkedin.query });
    });
    // Three ATS-scoped queries per lane, one host each, cycling methods so a
    // lane with one or two methods still reaches Workday, Greenhouse and iCIMS.
    for (let index = 0; index < Math.min(3, ATS_SEARCH_HOSTS.length) && methods.length > 0; index++) {
      const ats = methodQueryFamilies({ term: methods[index % methods.length], lane: lane.id, atsHost: ATS_SEARCH_HOSTS[index], linkedin: false })[1];
      queries.push({ route: ats.route, query: ats.query });
    }
    return {
      lane: lane.id,
      label: lane.label,
      keywords: methods,
      queries: queries.filter((item) => withinLimits(item.query)),
    };
  });
}

/**
 * Complements lane searches by inventorying student programs at a known employer.
 * This catches generic titles such as "Technology Co-Op" that carry little or no
 * scientific vocabulary in the search result. Every result is still archived
 * and classified after retrieval.
 */
export function buildEmployerSearchPlan(input: {
  employer: string;
  cycleYear: number;
  careersDomain?: string | null;
  programTerms?: string[];
  /** Adds the restrictive graduate precision arm; recall arms never require it. */
  graduateArm?: boolean;
}): EmployerSearchPlan {
  const employer = input.employer.trim();
  if (!employer) throw new Error("employer is required");
  if (!Number.isInteger(input.cycleYear) || input.cycleYear < 2020 || input.cycleYear > 2100) {
    throw new Error("cycleYear must be a four-digit year");
  }
  const domain = input.careersDomain?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) throw new Error("careersDomain must be a hostname");
  const historicalPrograms = (input.programTerms ?? [])
    .map((term) => term.trim().replaceAll('"', ''))
    .filter(Boolean)
    .slice(0, 4);
  return {
    employer,
    careersDomain: domain,
    queries: employerQueryFamilies({
      employer,
      careersDomain: domain,
      programTerms: historicalPrograms,
      graduateArm: input.graduateArm ?? false,
    }).map(({ route, query }) => ({ route, query })),
  };
}

export interface LeadResolution {
  originalUrl: string;
  route: DiscoveryRoute;
  canonicalEmployerUrl: string | null;
  resolution: "official_source_found" | "linkedin_only" | "aggregator_only" | "dead_link" | "unresolved";
  archiveReason: string;
}

/** LinkedIn and aggregator results remain archived, but cannot establish publication facts. */
export function resolveLead(input: {
  originalUrl: string;
  canonicalEmployerUrl?: string | null;
  originalRoute: DiscoveryRoute;
  originalReachable: boolean;
}): LeadResolution {
  const canonical = input.canonicalEmployerUrl?.trim() || null;
  if (canonical) {
    return {
      originalUrl: input.originalUrl,
      route: input.originalRoute,
      canonicalEmployerUrl: canonical,
      resolution: "official_source_found",
      archiveReason: "Lead resolved to an employer-controlled source for verification.",
    };
  }
  let linkedin = false;
  try {
    linkedin = /(^|\.)linkedin\.com$/i.test(new URL(input.originalUrl).hostname);
  } catch {
    return {
      originalUrl: input.originalUrl,
      route: input.originalRoute,
      canonicalEmployerUrl: null,
      resolution: "unresolved",
      archiveReason: "Lead URL was malformed; retained for officer correction and not used as publication evidence.",
    };
  }
  return {
    originalUrl: input.originalUrl,
    route: input.originalRoute,
    canonicalEmployerUrl: null,
    resolution: !input.originalReachable ? "dead_link" : linkedin ? "linkedin_only" : "unresolved",
    archiveReason: !input.originalReachable
      ? "Original lead was unavailable when checked; retained for history."
      : "No employer-controlled source was found; retained as an unresolved lead and not used as publication evidence.",
  };
}
