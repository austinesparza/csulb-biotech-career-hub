import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeUrl } from '../ingestion/normalize';
import { buildEmployerInventoryDiscoveryPlans, getEmployerInventoryMetadata } from './employer-inventory';
import { buildHistoricalWatchPlans, getHistoricalWatchMetadata } from './historical-watch';
import { archiveDiscoveryLead } from './lead-store-supabase';
import { resolveLead, type DiscoveryRoute } from './search-plan';
import type { SearchProvider } from './brave-search';

const ATS_HOSTS = new Set([
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com',
]);

export interface DiscoveryRunReport {
  runId: string;
  provider: string;
  employers: number;
  queries: number;
  results: number;
  archived: number;
  errors: string[];
}

function host(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function employerControlledUrl(resultUrl: string, careersDomain: string | null): string | null {
  const canonicalUrl = canonicalizeUrl(resultUrl);
  if (!canonicalUrl) return null;
  try {
    if (new URL(canonicalUrl).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  const resultHost = host(resultUrl);
  if (!resultHost || resultHost === 'linkedin.com' || resultHost.endsWith('.linkedin.com')) return null;
  if (ATS_HOSTS.has(resultHost)) return canonicalUrl;
  if (careersDomain && (resultHost === careersDomain || resultHost.endsWith(`.${careersDomain}`))) {
    return canonicalUrl;
  }
  return null;
}

function dailyOffset(date: Date): number {
  return Math.floor(date.valueOf() / 86_400_000);
}

export async function runEmployerDiscoveryBatch(params: {
  db: SupabaseClient;
  provider: SearchProvider;
  now?: Date;
  cycleYear?: number;
  employerLimit?: number;
  resultsPerQuery?: number;
  offset?: number;
  runId?: string;
}): Promise<DiscoveryRunReport> {
  const now = params.now ?? new Date();
  if (Number.isNaN(now.valueOf())) throw new Error('now must be a valid date');
  const cycleYear = params.cycleYear ?? (now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());
  const employerLimit = params.employerLimit ?? 1;
  const resultsPerQuery = params.resultsPerQuery ?? 5;
  if (!Number.isInteger(employerLimit) || employerLimit < 1 || employerLimit > 5) {
    throw new Error('employerLimit must be from 1 to 5');
  }
  if (!Number.isInteger(resultsPerQuery) || resultsPerQuery < 1 || resultsPerQuery > 10) {
    throw new Error('resultsPerQuery must be from 1 to 10');
  }
  const offset = params.offset ?? dailyOffset(now);
  const inventoryPlans = buildEmployerInventoryDiscoveryPlans({ cycleYear, limit: 50, offset: 0 })
    .map((candidate) => ({
      company: candidate.company,
      plan: candidate.plan,
      priority: candidate.localAlumniCount * 3,
      basis: 'local_employer_inventory' as const,
      predictionReady: false,
    }));
  const historicalPlans = buildHistoricalWatchPlans({ cycleYear, month: now.getUTCMonth() + 1 })
    .map((candidate) => ({
      company: candidate.company,
      plan: candidate.plan,
      priority: candidate.priority,
      basis: 'historical_role_watch' as const,
      predictionReady: candidate.predictionReady,
    }));
  const universe = [...historicalPlans, ...inventoryPlans]
    .toSorted((a, b) => b.priority - a.priority || a.company.localeCompare(b.company))
    .filter((candidate, index, allCandidates) => (
      allCandidates.findIndex((other) => other.company.toLowerCase() === candidate.company.toLowerCase()) === index
    ));
  const plans = Array.from(
    { length: Math.min(employerLimit, universe.length) },
    (_, index) => universe[(offset + index) % universe.length],
  );
  const runId = params.runId ?? `employer-inventory:${now.toISOString().slice(0, 10)}:${offset}`;
  const errors: string[] = [];
  let queryCount = 0;
  let resultCount = 0;
  let archived = 0;

  for (const candidate of plans) {
    const observations = await Promise.all(candidate.plan.queries.map(async ({ route, query }) => {
      queryCount += 1;
      try {
        const results = await params.provider.search(query, resultsPerQuery);
        return results.map((result) => ({ route, query, result }));
      } catch (error) {
        errors.push(`${candidate.company}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
        return [];
      }
    }));

    for (const { route, query, result } of observations.flat()) {
      resultCount += 1;
      const normalizedUrl = canonicalizeUrl(result.url);
      if (!normalizedUrl) {
        errors.push(`${candidate.company}: search result had an invalid URL`.slice(0, 500));
        continue;
      }
      const canonicalEmployerUrl = employerControlledUrl(normalizedUrl, candidate.plan.careersDomain);
      const resolution = resolveLead({
        originalUrl: normalizedUrl,
        canonicalEmployerUrl,
        originalRoute: route as DiscoveryRoute,
        originalReachable: true,
      });
      try {
        await archiveDiscoveryLead(params.db, {
          runId,
          route,
          query,
          lane: null,
          originalUrl: normalizedUrl,
          normalizedUrl,
          visibleTitle: result.title,
          visibleSnippet: result.snippet,
          employerHint: candidate.company,
          originalReachable: true,
          resolution: resolution.resolution,
          canonicalEmployerUrl: resolution.canonicalEmployerUrl,
          archiveReason: resolution.archiveReason,
          rawMetadata: {
            provider: params.provider.name,
            rank: result.rank,
            discoveryBasis: candidate.basis,
            predictionReady: candidate.predictionReady,
            inventorySourceCommit: candidate.basis === 'local_employer_inventory'
              ? getEmployerInventoryMetadata().sourceCommit
              : null,
            historicalSources: candidate.basis === 'historical_role_watch'
              ? getHistoricalWatchMetadata().sources
              : null,
          },
          retrievedAt: now.toISOString(),
        });
        archived += 1;
      } catch (error) {
        errors.push(`${candidate.company}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
      }
    }
  }

  return {
    runId,
    provider: params.provider.name,
    employers: plans.length,
    queries: queryCount,
    results: resultCount,
    archived,
    errors,
  };
}
