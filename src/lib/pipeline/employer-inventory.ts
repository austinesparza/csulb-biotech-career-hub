import inventorySnapshot from "../../../data/alumni-employer-inventory.json";
import { buildEmployerSearchPlan, type EmployerSearchPlan } from "./search-plan";

export interface EmployerInventoryRecord {
  company: string;
  website: string | null;
  industries: string[];
  descriptions: string[];
  locations: string[];
  regions: string[];
  localAlumniCount: number;
}

export interface EmployerDiscoveryCandidate extends EmployerInventoryRecord {
  priority: number;
  plan: EmployerSearchPlan;
}

const MAX_COHORT_SIZE = 50;
const employerInventory = inventorySnapshot.employers as EmployerInventoryRecord[];

function normalizeFilter(values: string[] | undefined): Set<string> | null {
  if (!values?.length) return null;
  return new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
}

function intersects(values: string[], filter: Set<string> | null): boolean {
  return filter === null || values.some((value) => filter.has(value.toLocaleLowerCase()));
}

function careersHost(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website);
    return url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * Returns a deterministic, bounded employer cohort for discovery planning.
 *
 * The inventory contains company-level metadata only. It does not grant permission
 * to fetch a site. A job source still needs its own terms and robots review, private
 * test, and explicit officer enablement before the ingestion worker can retrieve it.
 */
export function selectEmployerDiscoveryCohort(options: {
  limit?: number;
  offset?: number;
  industries?: string[];
  regions?: string[];
} = {}): EmployerInventoryRecord[] {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COHORT_SIZE) {
    throw new Error(`limit must be an integer from 1 to ${MAX_COHORT_SIZE}`);
  }
  const industries = normalizeFilter(options.industries);
  const regions = normalizeFilter(options.regions);
  const sorted = employerInventory
    .filter((employer) => intersects(employer.industries, industries) && intersects(employer.regions, regions))
    .toSorted((a, b) => b.localAlumniCount - a.localAlumniCount || a.company.localeCompare(b.company));
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer');
  if (sorted.length === 0) return [];
  return Array.from({ length: Math.min(limit, sorted.length) }, (_, index) => sorted[(offset + index) % sorted.length]);
}

/**
 * Builds query plans only. A configured search provider must execute each query,
 * and every returned result must enter the private discovery-lead archive.
 */
export function buildEmployerInventoryDiscoveryPlans(options: {
  cycleYear: number;
  limit?: number;
  offset?: number;
  industries?: string[];
  regions?: string[];
}): EmployerDiscoveryCandidate[] {
  return selectEmployerDiscoveryCohort(options).map((employer) => ({
    ...employer,
    priority: employer.localAlumniCount,
    plan: buildEmployerSearchPlan({
      employer: employer.company,
      cycleYear: options.cycleYear,
      careersDomain: careersHost(employer.website),
    }),
  }));
}

export function getEmployerInventoryMetadata() {
  return inventorySnapshot._meta;
}
