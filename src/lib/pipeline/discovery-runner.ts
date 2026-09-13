import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeUrl } from '../ingestion/normalize';
import { isRecognizedAtsHost } from './ats-hosts';
import { classify, loadTaxonomy, type Taxonomy } from './classify';
import { buildEmployerInventoryDiscoveryPlans, getEmployerInventoryMetadata } from './employer-inventory';
import { buildHistoricalWatchPlans, getHistoricalWatchMetadata } from './historical-watch';
import { archiveDiscoveryLead } from './lead-store-supabase';
import { buildLaneSearchPlans, resolveLead, type DiscoveryRoute } from './search-plan';
import type { SearchProvider } from './brave-search';

export interface DiscoveryRunReport {
  runId: string;
  provider: string;
  employers: number;
  lanes: number;
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
  if (isRecognizedAtsHost(resultHost)) {
    return canonicalUrl;
  }
  if (careersDomain && (resultHost === careersDomain || resultHost.endsWith(`.${careersDomain}`))) {
    return canonicalUrl;
  }
  return null;
}

function observedRoute(resultUrl: string, careersDomain: string | null): DiscoveryRoute {
  const resultHost = host(resultUrl);
  if (!resultHost) return 'web_search';
  if (resultHost === 'linkedin.com' || resultHost.endsWith('.linkedin.com')) return 'linkedin_lead';
  if (isRecognizedAtsHost(resultHost)) return 'official_feed';
  if (careersDomain && (resultHost === careersDomain || resultHost.endsWith(`.${careersDomain}`))) {
    return 'employer_page';
  }
  return 'web_search';
}

function snippetTriage(input: {
  title: string;
  snippet: string | null;
  employer: string | null;
  taxonomy: Taxonomy;
}): Record<string, unknown> {
  const classification = classify({
    title: input.title,
    employer: input.employer ?? '',
    body: input.snippet ?? '',
  }, input.taxonomy);
  return {
    advisoryOnly: true,
    keep: classification.keep,
    score: classification.score,
    suggestedBucket: classification.suggestedBucket,
    opportunityType: classification.opportunityType?.id ?? null,
    lanes: classification.lanes.map((lane) => lane.id),
    dropReason: classification.dropReason ?? null,
  };
}

export function discoveryOffsetForDate(date: Date, employerLimit: number): number {
  if (Number.isNaN(date.valueOf())) throw new Error('date must be valid');
  if (!Number.isInteger(employerLimit) || employerLimit < 1 || employerLimit > 5) {
    throw new Error('employerLimit must be from 1 to 5');
  }
  return Math.floor(date.valueOf() / 86_400_000) * employerLimit;
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
  taxonomy?: Taxonomy;
}): Promise<DiscoveryRunReport> {
  const now = params.now ?? new Date();
  if (Number.isNaN(now.valueOf())) throw new Error('now must be a valid date');
  const cycleYear = params.cycleYear ?? (now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());
  const employerLimit = params.employerLimit ?? 5;
  const resultsPerQuery = params.resultsPerQuery ?? 5;
  const taxonomy = params.taxonomy ?? loadTaxonomy();
  if (!Number.isInteger(employerLimit) || employerLimit < 1 || employerLimit > 5) {
    throw new Error('employerLimit must be from 1 to 5');
  }
  if (!Number.isInteger(resultsPerQuery) || resultsPerQuery < 1 || resultsPerQuery > 10) {
    throw new Error('resultsPerQuery must be from 1 to 10');
  }
  // Advance by a complete batch every day. The previous one-employer stride
  // caused an N=5 run to repeat four of yesterday's employers and made full
  // inventory coverage roughly five times slower than intended.
  const offset = params.offset ?? discoveryOffsetForDate(now, employerLimit);
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
      // Lead identity follows the observed host, not the query family. The same
      // URL found by several search routes therefore reuses one private lead
      // while retaining every query as a separate observation.
      const resultRoute = observedRoute(normalizedUrl, candidate.plan.careersDomain);
      const resolution = resolveLead({
        originalUrl: normalizedUrl,
        canonicalEmployerUrl,
        originalRoute: resultRoute,
        originalReachable: true,
      });
      try {
        await archiveDiscoveryLead(params.db, {
          runId,
          route: resultRoute,
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
            queryRoute: route,
            snippetTriage: snippetTriage({
              title: result.title ?? '',
              snippet: result.snippet,
              employer: candidate.company,
              taxonomy,
            }),
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
    lanes: 0,
    queries: queryCount,
    results: resultCount,
    archived,
    errors,
  };
}

export async function runLaneDiscoveryBatch(params: {
  db: SupabaseClient;
  provider: SearchProvider;
  now?: Date;
  cycleYear?: number;
  laneLimit?: number;
  resultsPerQuery?: number;
  offset?: number;
  runId?: string;
  taxonomy?: Taxonomy;
}): Promise<DiscoveryRunReport> {
  const now = params.now ?? new Date();
  if (Number.isNaN(now.valueOf())) throw new Error('now must be a valid date');
  const cycleYear = params.cycleYear ?? (now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());
  const laneLimit = params.laneLimit ?? 1;
  const resultsPerQuery = params.resultsPerQuery ?? 5;
  if (!Number.isInteger(laneLimit) || laneLimit < 1 || laneLimit > 2) {
    throw new Error('laneLimit must be from 1 to 2');
  }
  if (!Number.isInteger(resultsPerQuery) || resultsPerQuery < 1 || resultsPerQuery > 10) {
    throw new Error('resultsPerQuery must be from 1 to 10');
  }

  const taxonomy = params.taxonomy ?? loadTaxonomy();
  const universe = buildLaneSearchPlans(taxonomy, cycleYear);
  const offset = params.offset ?? discoveryOffsetForDate(now, laneLimit);
  const plans = Array.from(
    { length: Math.min(laneLimit, universe.length) },
    (_, index) => universe[(offset + index) % universe.length],
  );
  const runId = params.runId ?? `scientific-lanes:${now.toISOString().slice(0, 10)}:${offset}`;
  const errors: string[] = [];
  let queryCount = 0;
  let resultCount = 0;
  let archived = 0;

  for (const plan of plans) {
    const observations = await Promise.all(plan.queries.map(async ({ route, query }) => {
      queryCount += 1;
      try {
        const results = await params.provider.search(query, resultsPerQuery);
        return results.map((result) => ({ route, query, result }));
      } catch (error) {
        errors.push(`${plan.lane}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
        return [];
      }
    }));

    for (const { route, query, result } of observations.flat()) {
      resultCount += 1;
      const normalizedUrl = canonicalizeUrl(result.url);
      if (!normalizedUrl) {
        errors.push(`${plan.lane}: search result had an invalid URL`.slice(0, 500));
        continue;
      }
      const canonicalEmployerUrl = employerControlledUrl(normalizedUrl, null);
      const resultRoute = observedRoute(normalizedUrl, null);
      const resolution = resolveLead({
        originalUrl: normalizedUrl,
        canonicalEmployerUrl,
        originalRoute: resultRoute,
        originalReachable: true,
      });
      try {
        await archiveDiscoveryLead(params.db, {
          runId,
          route: resultRoute,
          query,
          lane: plan.lane,
          originalUrl: normalizedUrl,
          normalizedUrl,
          visibleTitle: result.title,
          visibleSnippet: result.snippet,
          employerHint: null,
          originalReachable: true,
          resolution: resolution.resolution,
          canonicalEmployerUrl: resolution.canonicalEmployerUrl,
          archiveReason: resolution.archiveReason,
          rawMetadata: {
            provider: params.provider.name,
            rank: result.rank,
            queryRoute: route,
            snippetTriage: snippetTriage({
              title: result.title ?? '',
              snippet: result.snippet,
              employer: null,
              taxonomy,
            }),
            discoveryBasis: 'scientific_lane_rotation',
            laneLabel: plan.label,
          },
          retrievedAt: now.toISOString(),
        });
        archived += 1;
      } catch (error) {
        errors.push(`${plan.lane}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
      }
    }
  }

  return {
    runId,
    provider: params.provider.name,
    employers: 0,
    lanes: plans.length,
    queries: queryCount,
    results: resultCount,
    archived,
    errors,
  };
}
