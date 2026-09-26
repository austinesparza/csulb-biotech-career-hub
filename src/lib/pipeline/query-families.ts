/**
 * query-families.ts — bounded, recall-first search query families.
 *
 * Why this exists. The earlier plans combined large quoted OR groups with a
 * mandatory year, season, degree phrase and scientific stem in one query. On
 * the September evaluation set that shape cannot match most roles by title:
 * "Research Intern - Temporary", "PALM and Artificial Intelligence Co-op",
 * "R&D Lab Analyst" or "Intern" carry no science word, no year and no degree.
 * Stems such as "oncolog" or "immunolog" also do not match whole-word search
 * engines when quoted. Brave documents `site:`, quotes and uppercase OR/AND/NOT
 * but NOT parentheses, so grouped queries rely on undocumented behaviour.
 *
 * Rules:
 *   - one short query per family, at most one OR list, no parentheses;
 *   - recall arms never require a year, season, degree or science term;
 *   - restrictive terms (graduate, master's) live in a separate precision arm;
 *   - LinkedIn job pages and employer hiring posts stay discovery surfaces
 *     only; publication facts still require an employer page;
 *   - every query stays under conservative provider limits.
 *
 * The OR semantics assumed here (OR binds its neighbours; other terms are ANDed)
 * are the common engine behaviour. Confirm with a bounded dry run before
 * relying on counts; see docs/research/2026-09-27-official-posting-verification.md.
 */
import registry from "../../../data/ats-tenant-registry.json";
import type { DiscoveryRoute } from "./search-plan";

export const QUERY_LIMITS = { maxChars: 380, maxWords: 40 } as const;

export type QueryFamily =
  | "employer_roles"
  | "employer_tenant"
  | "employer_offcycle"
  | "employer_programs"
  | "employer_graduate"
  | "linkedin_jobs"
  | "linkedin_posts"
  | "method_roles"
  | "method_ats"
  | "method_linkedin";

export interface PlannedQuery {
  family: QueryFamily;
  route: DiscoveryRoute;
  query: string;
  /** True when the query deliberately narrows by degree or eligibility. */
  restrictive: boolean;
  employer?: string;
  method?: string;
  lane?: string;
}

/**
 * Searchable method and science phrases. Whole words only: search engines do
 * not stem quoted phrases, so taxonomy stems ("oncolog") are never used here.
 */
export const METHOD_TERMS: Array<{ term: string; lane: string }> = [
  { term: "oncology", lane: "cancer" },
  { term: "cancer biology", lane: "cancer" },
  { term: "tumor microenvironment", lane: "cancer" },
  { term: "liquid biopsy", lane: "cancer" },
  { term: "immuno-oncology", lane: "cancer" },
  { term: "translational research", lane: "cancer" },
  { term: "genomics", lane: "genomics" },
  { term: "sequencing", lane: "genomics" },
  { term: "long-read sequencing", lane: "genomics" },
  { term: "next-generation sequencing", lane: "genomics" },
  { term: "CRISPR", lane: "genomics" },
  { term: "functional genomics", lane: "genomics" },
  { term: "gene therapy", lane: "genomics" },
  { term: "single-cell", lane: "single_cell" },
  { term: "spatial biology", lane: "single_cell" },
  { term: "flow cytometry", lane: "single_cell" },
  { term: "bioinformatics", lane: "bioinformatics" },
  { term: "computational biology", lane: "bioinformatics" },
  { term: "biostatistics", lane: "bioinformatics" },
  { term: "multiomics", lane: "bioinformatics" },
  { term: "machine learning", lane: "data_science" },
  { term: "data science", lane: "data_science" },
  { term: "artificial intelligence", lane: "data_science" },
  { term: "pharmacometrics", lane: "data_science" },
  { term: "diagnostics", lane: "diagnostics" },
  { term: "assay development", lane: "diagnostics" },
  { term: "biomarker", lane: "diagnostics" },
  { term: "immunoassay", lane: "diagnostics" },
  { term: "molecular diagnostics", lane: "diagnostics" },
  { term: "process development", lane: "bioprocess" },
  { term: "cell line development", lane: "bioprocess" },
  { term: "bioassay", lane: "bioprocess" },
  { term: "MSAT", lane: "bioprocess" },
  { term: "vaccine", lane: "immunology" },
  { term: "immunology", lane: "immunology" },
  { term: "infectious disease", lane: "immunology" },
  { term: "drug discovery", lane: "protein_drug" },
  { term: "pharmacology", lane: "protein_drug" },
  { term: "protein engineering", lane: "protein_drug" },
  { term: "cell therapy", lane: "protein_drug" },
  { term: "regenerative medicine", lane: "protein_drug" },
  { term: "neuroscience", lane: "neuro" },
  { term: "lab automation", lane: "lab_automation" },
  { term: "research and development", lane: "research" },
  { term: "laboratory", lane: "research" },
  { term: "quality", lane: "quality" },
  { term: "regulatory affairs", lane: "regulatory" },
  { term: "clinical operations", lane: "clinical" },
];

/** Public ATS hosts searched method-by-method, one host per query. */
export const ATS_SEARCH_HOSTS = [
  "myworkdayjobs.com",
  "job-boards.greenhouse.io",
  "icims.com",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "boards.greenhouse.io",
  "yello.co",
  "prismhr-hire.com",
] as const;

interface TenantEntry { host: string; site: string | null; employer: string; aliases: string[]; operatingCompanies: string[]; shared?: boolean; kind: string }
const TENANTS = (registry as { tenants: TenantEntry[] }).tenants;

function quote(value: string): string {
  return `"${value.replaceAll('"', "").trim()}"`;
}

export function withinLimits(query: string): boolean {
  return query.length <= QUERY_LIMITS.maxChars && query.split(/\s+/).filter(Boolean).length <= QUERY_LIMITS.maxWords;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Recruiting hosts known for an employer (identity metadata, not fetch permission). */
export function tenantHostsFor(employer: string): string[] {
  const key = normalizeName(employer);
  const hosts = TENANTS.filter((tenant) => [tenant.employer, ...tenant.aliases, ...tenant.operatingCompanies]
    .some((name) => normalizeName(name) === key))
    .map((tenant) => tenant.host);
  return [...new Set(hosts)];
}

/** Employers named in the tenant registry: the requisition watchlist. */
export function registryEmployers(): string[] {
  return [...new Set(TENANTS.filter((tenant) => !tenant.shared).map((tenant) => tenant.employer))].sort();
}

const SHARED_HOSTS = new Set(["job-boards.greenhouse.io", "boards.greenhouse.io", "workforcenow.adp.com", "www.zintellect.com"]);

/**
 * Query families for one employer. No arm except `employer_graduate` requires
 * a degree, year or science term.
 */
export function employerQueryFamilies(input: {
  employer: string;
  careersDomain?: string | null;
  graduateArm?: boolean;
  programTerms?: string[];
}): PlannedQuery[] {
  const employer = input.employer.trim();
  if (!employer) throw new Error("employer is required");
  const named = quote(employer);
  const hosts = [...new Set([...tenantHostsFor(employer), ...(input.careersDomain ? [input.careersDomain.toLowerCase()] : [])])].slice(0, 2);
  const out: PlannedQuery[] = [
    { family: "employer_roles", route: "web_search", query: `${named} intern OR interns OR internship OR co-op`, restrictive: false, employer },
  ];
  for (const host of hosts) {
    // A shared host (Greenhouse, ADP) needs the employer name; a tenant host
    // does not, which is how generic titles ("Intern", "Technology Co-op") surface.
    const scoped = SHARED_HOSTS.has(host) ? `site:${host} ${named}` : `site:${host}`;
    out.push({ family: "employer_tenant", route: "employer_page", query: `${scoped} intern OR interns OR internship OR co-op`, restrictive: false, employer });
  }
  out.push({ family: "employer_offcycle", route: "web_search", query: `${named} co-op spring OR fall OR "off-cycle"`, restrictive: false, employer });
  const programs = (input.programTerms ?? []).map((term) => term.trim()).filter(Boolean).slice(0, 3);
  if (programs.length) {
    // Historical program names ("Future Talent Program", "Quality Compliance
    // Internship") without a year: programs keep their names across cycles.
    out.push({ family: "employer_programs", route: "web_search", query: `${named} ${programs.map(quote).join(" OR ")}`, restrictive: false, employer });
  }
  if (input.graduateArm) {
    out.push({ family: "employer_graduate", route: "web_search", query: `${named} intern "master's" OR graduate OR PhD`, restrictive: true, employer });
  }
  out.push({ family: "linkedin_jobs", route: "linkedin_lead", query: `site:linkedin.com/jobs/view ${named} intern OR internship OR co-op`, restrictive: false, employer });
  out.push({ family: "linkedin_posts", route: "linkedin_lead", query: `site:linkedin.com/posts ${named} internship OR co-op OR intern`, restrictive: false, employer });
  return out.filter((item) => withinLimits(item.query));
}

/** Employer-agnostic families for one method phrase. */
export function methodQueryFamilies(input: { term: string; lane: string; atsHost: string; linkedin?: boolean }): PlannedQuery[] {
  const method = quote(input.term);
  const out: PlannedQuery[] = [
    { family: "method_roles", route: "web_search", query: `${method} intern OR interns OR internship OR co-op`, restrictive: false, method: input.term, lane: input.lane },
    { family: "method_ats", route: "official_feed", query: `site:${input.atsHost} ${method} intern OR co-op`, restrictive: false, method: input.term, lane: input.lane },
  ];
  if (input.linkedin !== false) {
    out.push({ family: "method_linkedin", route: "linkedin_lead", query: `site:linkedin.com/jobs/view ${method} intern OR co-op`, restrictive: false, method: input.term, lane: input.lane });
  }
  return out.filter((item) => withinLimits(item.query));
}

/** Days until every item in a rotation has been searched once. */
export function rotationDays(count: number, perDay: number): number {
  return perDay > 0 ? Math.ceil(count / perDay) : Infinity;
}
