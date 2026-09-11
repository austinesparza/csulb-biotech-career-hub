import {
  buildEmployerInventoryDiscoveryPlans,
  getEmployerInventoryMetadata,
} from "../src/lib/pipeline/employer-inventory";

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function list(name: string): string[] | undefined {
  const values = process.env[name]?.split(",").map((value) => value.trim()).filter(Boolean);
  return values?.length ? values : undefined;
}

const now = new Date();
const defaultCycleYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
const cycleYear = positiveInteger("EMPLOYER_DISCOVERY_CYCLE_YEAR", defaultCycleYear);
const limit = positiveInteger("EMPLOYER_DISCOVERY_LIMIT", 25);
const regions = list("EMPLOYER_DISCOVERY_REGIONS");
const industries = list("EMPLOYER_DISCOVERY_INDUSTRIES");
const candidates = buildEmployerInventoryDiscoveryPlans({ cycleYear, limit, regions, industries });

console.log(JSON.stringify({
  generatedAt: now.toISOString(),
  cycleYear,
  filters: { limit, regions: regions ?? [], industries: industries ?? [] },
  inventory: getEmployerInventoryMetadata(),
  candidateCount: candidates.length,
  candidates,
}, null, 2));
