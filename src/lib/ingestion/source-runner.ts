import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchGreenhouseJobs } from "./connectors/greenhouse";
import { sha256Hex, stableSerialize } from "./hash";
import {
  canonicalizeUrl,
  classifyOpportunity,
  classifyRemoteType,
  inferFocusArea,
  normalizeEmployerName,
  normalizeJobTitle,
  normalizeLocation,
} from "./normalize";
import { persistFetchResultWithSupabase } from "./persistence/persist-fetch-result";
import type { IngestionDbClient, IngestionStorageClient } from "./persistence/repository";
import { SCORE_VERSION, scoreIngestionCandidate } from "./score";
import type { ConnectorFetchResult, SourceKind } from "./types";
import { page } from "../pipeline/connectors";
import { createFetchChain, conditionalGetTier, scraplingTier, scrapeGraphTier, type FetchOutcome, type TierState, type TierStore } from "../pipeline/fetch-chain";
import { safeFetch } from "../pipeline/safe-fetch";
import { createScrapeGraphClient, createScraplingClient } from "../pipeline/scraping-clients";

export interface ClaimedFetchRun {
  id: string;
  job_source_id: string;
}

export interface RunnableJobSource {
  id: string;
  source_name: string;
  source_kind: SourceKind;
  source_identifier: string | null;
  careers_url: string;
  api_endpoint: string | null;
  config_json: Record<string, unknown>;
  enabled: boolean;
  terms_reviewed: boolean;
  terms_review_date: string | null;
  robots_reviewed: boolean;
  automatic_scheduling_paused_at: string | null;
  consecutive_failures: number;
  fetch_tier: 0 | 1 | 2;
  tier_clean_runs: number;
}

export interface SourceRunReport {
  fetchRunId: string;
  jobSourceId: string;
  sourceKind: SourceKind | "unknown";
  status: "completed" | "partial" | "failed";
  recordsSeen: number;
  recordsArchived: number;
  reviewTasksCreated: number;
  error: string | null;
  warnings: string[];
}

type ConnectorPort = (source: RunnableJobSource, context: { db: SupabaseClient; privateTest?: boolean }) => Promise<ConnectorFetchResult>;

function failure(source: RunnableJobSource, message: string): ConnectorFetchResult {
  return {
    ok: false,
    candidates: [],
    rawResponseText: null,
    requestUrl: source.api_endpoint ?? source.careers_url,
    finalUrl: null,
    httpStatus: null,
    contentType: null,
    etag: null,
    lastModified: null,
    fetchedAt: new Date().toISOString(),
    recordsSeen: 0,
    recordsNormalized: 0,
    recordsSkipped: 0,
    issues: [],
    error: { errorClass: "schema", code: "invalid_config", message },
  };
}

export class SourceTierStore implements TierStore {
  constructor(
    private readonly db: SupabaseClient,
    private readonly source: RunnableJobSource,
    private readonly persistChanges = true,
  ) {}

  async get(): Promise<TierState> {
    return { sourceId: this.source.id, tier: this.source.fetch_tier, cleanRuns: this.source.tier_clean_runs };
  }

  async set(state: TierState): Promise<void> {
    if (this.persistChanges) {
      const { error } = await this.db.from("job_sources").update({
        fetch_tier: state.tier,
        tier_clean_runs: state.cleanRuns,
        tier_reason: state.reason ?? null,
        tier_changed_at: new Date().toISOString(),
      }).eq("id", this.source.id);
      if (error) throw new Error(`save fetch tier state: ${error.message}`);
    }
    this.source.fetch_tier = state.tier;
    this.source.tier_clean_runs = state.cleanRuns;
  }

  async spentThisPeriod(): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const { count, error } = await this.db.from("source_fetch_runs")
      .select("id", { count: "exact", head: true })
      .eq("fetch_tier", 2)
      .gte("created_at", start.toISOString());
    if (error) throw new Error(`load hosted fetch spend: ${error.message}`);
    return (count ?? 0) * 0.01;
  }
}

export function staticPageResult(source: RunnableJobSource, rawText: string, outcome: FetchOutcome | null): ConnectorFetchResult {
  const parsed = page.parse(rawText, { employer: source.source_name, identifier: source.careers_url });
  if (parsed.postings.length === 0) {
    return {
      ...failure(source, parsed.warnings[0] ?? "Static page produced no usable document"),
      rawResponseText: rawText,
      httpStatus: outcome?.status ?? 200,
    };
  }
  const candidates = parsed.postings.map((posting) => {
    const titleRaw = posting.title || source.source_name;
    const titleNormalized = normalizeJobTitle(titleRaw);
    const employerNameNormalized = normalizeEmployerName(source.source_name);
    const locationNormalized = normalizeLocation(posting.location);
    const remote = classifyRemoteType(titleRaw, posting.location, posting.rawText);
    const opportunity = classifyOpportunity(titleRaw, null, posting.rawText);
    const uncertaintyFlags = [
      ...(posting.location ? [] : ["location_missing" as const]),
      "deadline_missing" as const,
      "eligibility_missing" as const,
      ...(opportunity.inferred ? ["classification_inferred" as const] : []),
      ...remote.flags,
    ];
    const canonicalUrl = canonicalizeUrl(posting.url) ?? source.careers_url;
    const scoreBreakdown = scoreIngestionCandidate({
      employerName: source.source_name,
      titleRaw,
      titleNormalized,
      locationNormalized,
      department: null,
      departments: [],
      classification: opportunity.classification,
      remoteType: remote.remoteType,
      canonicalUrl,
      descriptionText: posting.rawText,
      closesAt: null,
      uncertaintyFlags,
    });
    return {
      identityKey: `static_html:${source.id}:${sha256Hex(canonicalUrl)}`,
      materialHash: sha256Hex(stableSerialize({ titleRaw, canonicalUrl, rawText: posting.rawText })),
      connectorVersion: "static-html/1.0.0",
      sourceKind: "static_html" as const,
      externalPostingId: canonicalUrl,
      internalJobId: null,
      requisitionId: null,
      employerNameRaw: source.source_name,
      employerNameNormalized,
      titleRaw,
      titleNormalized,
      locationRaw: posting.location || null,
      locationNormalized,
      canonicalUrl,
      remoteType: remote.remoteType,
      employmentType: null,
      classification: opportunity.classification,
      department: null,
      departments: [],
      offices: [],
      focusArea: scoreBreakdown.taxonomyClassification.lanes[0]?.label ?? inferFocusArea(titleRaw, posting.rawText),
      postedAt: null,
      closesAt: null,
      deadlineKind: "unknown" as const,
      descriptionText: posting.rawText,
      language: null,
      sourceUpdatedAt: null,
      sourceMetadata: { fetchTier: outcome?.tier ?? 0, tierName: outcome?.tierName ?? "conditional-get", attempts: outcome?.attempts ?? [] },
      relevanceScore: scoreBreakdown.total,
      relevanceScoreVersion: SCORE_VERSION,
      scoreBreakdown,
      uncertaintyFlags: [...new Set(scoreBreakdown.uncertaintyFlags)],
      fetchedAt: new Date().toISOString(),
    };
  });
  return {
    ok: true,
    candidates,
    rawResponseText: rawText,
    requestUrl: source.careers_url,
    finalUrl: source.careers_url,
    httpStatus: outcome?.status ?? 200,
    contentType: outcome?.tier === 2 ? "text/markdown" : "text/html",
    etag: outcome?.etag ?? null,
    lastModified: outcome?.lastModified ?? null,
    fetchedAt: candidates[0].fetchedAt,
    recordsSeen: candidates.length,
    recordsNormalized: candidates.length,
    recordsSkipped: 0,
    issues: [],
    error: null,
  };
}

async function fetchStaticPage(source: RunnableJobSource, db: SupabaseClient, privateTest = false): Promise<ConnectorFetchResult> {
  const tiers = [conditionalGetTier(async (url, options) => safeFetch(url, options))];
  if (process.env.PIPELINE_SCRAPLING_ENABLED === "true") tiers.push(scraplingTier(createScraplingClient()));
  if (process.env.SCRAPEGRAPH_API_KEY) tiers.push(scrapeGraphTier(createScrapeGraphClient()));
  const chain = createFetchChain(tiers, new SourceTierStore(db, source, !privateTest), {
    budgetPerPeriod: Number(process.env.SCRAPEGRAPH_MONTHLY_BUDGET ?? 1),
  });
  const fetcher = chain(source.id);
  try {
    const response = await fetcher(source.careers_url, { etag: null, lastModified: null });
    if (!("body" in response)) {
      return failure(source, "Static page returned 304 but no prior body is available to this run");
    }
    return staticPageResult(source, response.body, fetcher.lastOutcome());
  } catch (error) {
    return failure(source, error instanceof Error ? error.message : String(error));
  }
}

export function defaultConnector(source: RunnableJobSource, context: { db: SupabaseClient; privateTest?: boolean }): Promise<ConnectorFetchResult> {
  if (source.source_kind === "static_html" || source.source_kind === "schema_org") {
    return fetchStaticPage(source, context.db, context.privateTest);
  }
  if (source.source_kind !== "greenhouse") {
    return Promise.resolve(failure(
      source,
      `Source kind ${source.source_kind} is registered but does not yet have an operational connector. The queue item was retained.`,
    ));
  }
  const configured = source.config_json.boardToken;
  const boardToken = typeof configured === "string" ? configured : source.source_identifier;
  if (!boardToken) return Promise.resolve(failure(source, "Greenhouse source requires source_identifier or config_json.boardToken"));
  return fetchGreenhouseJobs({ boardToken });
}

export function sourceGovernanceError(source: RunnableJobSource, privateTest = false): string | null {
  if (!privateTest && !source.enabled) return "source is disabled";
  if (!source.terms_reviewed || !source.terms_review_date) return "source terms review is incomplete";
  if (!source.robots_reviewed) return "source robots review is incomplete";
  if (!privateTest && source.automatic_scheduling_paused_at) return "source scheduling is paused";
  return null;
}

function governanceFailure(source: RunnableJobSource, privateTest = false): ConnectorFetchResult | null {
  const error = sourceGovernanceError(source, privateTest);
  return error ? failure(source, error) : null;
}

async function updateSourceHealth(db: SupabaseClient, source: RunnableJobSource, result: ConnectorFetchResult): Promise<void> {
  const failedCount = result.ok ? 0 : source.consecutive_failures + 1;
  const update: Record<string, unknown> = {
    last_attempted_at: result.fetchedAt,
    last_http_status: result.httpStatus,
    consecutive_failures: failedCount,
    ...(result.rawResponseText ? { last_payload_hash: sha256Hex(result.rawResponseText) } : {}),
  };
  if (result.ok) {
    update.last_successful_at = result.fetchedAt;
    update.degraded_at = null;
  } else if (failedCount >= 3) {
    update.degraded_at = new Date().toISOString();
  }
  const { error } = await db.from("job_sources").update(update).eq("id", source.id);
  if (error) throw new Error(`update source health: ${error.message}`);
}

export async function runClaimedFetch(params: {
  db: SupabaseClient;
  storage: IngestionStorageClient;
  claim: ClaimedFetchRun;
  connector?: ConnectorPort;
  privateTest?: boolean;
}): Promise<SourceRunReport> {
  const { data, error } = await params.db.from("job_sources")
    .select("id, source_name, source_kind, source_identifier, careers_url, api_endpoint, config_json, enabled, terms_reviewed, terms_review_date, robots_reviewed, automatic_scheduling_paused_at, consecutive_failures, fetch_tier, tier_clean_runs")
    .eq("id", params.claim.job_source_id)
    .maybeSingle();
  if (error) throw new Error(`load job source: ${error.message}`);
  if (!data) throw new Error(`job source ${params.claim.job_source_id} not found`);
  const source = data as RunnableJobSource;
  const result = governanceFailure(source, params.privateTest) ?? await (params.connector ?? defaultConnector)(source, {
    db: params.db,
    privateTest: params.privateTest,
  });
  const summary = await persistFetchResultWithSupabase({
    db: params.db as unknown as IngestionDbClient,
    storage: params.storage,
    fetchRunId: params.claim.id,
    expectedJobSourceId: source.id,
    fetchResult: result,
    logContext: params.privateTest ? { privateTest: true } : undefined,
  });
  const warnings: string[] = [];
  const tier = result.ok && result.candidates[0]?.sourceMetadata && typeof result.candidates[0].sourceMetadata === "object"
    ? (result.candidates[0].sourceMetadata as Record<string, unknown>).fetchTier
    : null;
  if (typeof tier === "number") {
    const { error: tierError } = await params.db.from("source_fetch_runs").update({ fetch_tier: tier }).eq("id", params.claim.id);
    if (tierError) warnings.push(`fetch tier provenance update failed: ${tierError.message}`);
  }
  if (!params.privateTest) {
    try {
      await updateSourceHealth(params.db, source, result);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    fetchRunId: params.claim.id,
    jobSourceId: source.id,
    sourceKind: source.source_kind,
    status: summary.fetchRunStatus === "completed" || summary.fetchRunStatus === "partial" ? summary.fetchRunStatus : "failed",
    recordsSeen: result.recordsSeen,
    recordsArchived: result.recordsNormalized,
    reviewTasksCreated: summary.counters.recordsReviewed,
    error: result.error?.message ?? null,
    warnings,
  };
}

async function finalizeUnexpectedWorkerFailure(db: SupabaseClient, claim: ClaimedFetchRun, message: string): Promise<string | null> {
  const { error } = await db.from("source_fetch_runs").update({
    status: "failed",
    finished_at: new Date().toISOString(),
    error_class: "unexpected",
    error_message: message.slice(0, 1000),
    log_json: { workerFailure: message.slice(0, 1000) },
  }).eq("id", claim.id).eq("status", "running");
  return error ? `failed to finalize worker error: ${error.message}` : null;
}

export async function runIngestionBatch(params: {
  db: SupabaseClient;
  storage: IngestionStorageClient;
  workerId: string;
  limit?: number;
  connector?: ConnectorPort;
}): Promise<SourceRunReport[]> {
  const limit = params.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("ingestion batch limit must be an integer from 1 to 50");
  if (!params.workerId.trim()) throw new Error("workerId is required");
  const { data, error } = await params.db.rpc("claim_source_fetch_runs", {
    p_worker_id: params.workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`claim source fetch runs: ${error.message}`);
  const claims = (data ?? []) as ClaimedFetchRun[];
  const reports: SourceRunReport[] = [];
  for (const claim of claims) {
    try {
      reports.push(await runClaimedFetch({ ...params, claim }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finalizeWarning = await finalizeUnexpectedWorkerFailure(params.db, claim, message);
      reports.push({
        fetchRunId: claim.id,
        jobSourceId: claim.job_source_id,
        sourceKind: "unknown",
        status: "failed",
        recordsSeen: 0,
        recordsArchived: 0,
        reviewTasksCreated: 0,
        error: message,
        warnings: finalizeWarning ? [finalizeWarning] : [],
      });
    }
  }
  return reports;
}
