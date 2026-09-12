import { getConnector } from '../../pipeline/connectors';
import type { CanonicalPosting, ConnectorResult } from '../../pipeline/connectors/types';
import { createUsaJobsFetcher, safeFetch, type SafeFetchResponse } from '../../pipeline/safe-fetch';
import { sha256Hex, stableSerialize } from '../hash';
import {
  canonicalizeUrl,
  classifyOpportunity,
  classifyRemoteType,
  inferFocusArea,
  normalizeEmployerName,
  normalizeJobTitle,
  normalizeLocation,
} from '../normalize';
import { SCORE_VERSION, scoreIngestionCandidate } from '../score';
import type {
  ConnectorFetchFailure,
  ConnectorFetchResult,
  NormalizedSourcePosting,
  SourceKind,
  UncertaintyFlag,
} from '../types';

export type PublicApiSourceKind = Extract<SourceKind, 'ashby' | 'lever' | 'usajobs'>;

export interface PublicApiSource {
  source_name: string;
  source_kind: PublicApiSourceKind;
  source_identifier: string | null;
  api_endpoint: string | null;
}

function isHttpsUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

type PublicApiFetcher = (
  url: string,
  options: { etag: string | null; lastModified: string | null },
) => Promise<SafeFetchResponse>;

function failure(params: {
  requestUrl: string;
  fetchedAt: string;
  message: string;
  code?: 'invalid_config' | 'invalid_shape' | 'server_error';
  errorClass?: 'schema' | 'network' | 'auth' | 'unexpected';
  httpStatus?: number | null;
  rawResponseText?: string | null;
}): ConnectorFetchFailure {
  return {
    ok: false,
    candidates: [],
    rawResponseText: params.rawResponseText ?? null,
    requestUrl: params.requestUrl,
    finalUrl: null,
    httpStatus: params.httpStatus ?? null,
    contentType: 'application/json',
    etag: null,
    lastModified: null,
    fetchedAt: params.fetchedAt,
    recordsSeen: 0,
    recordsNormalized: 0,
    recordsSkipped: 0,
    issues: [],
    error: {
      errorClass: params.errorClass ?? 'schema',
      code: params.code ?? 'invalid_config',
      message: params.message,
      ...(params.httpStatus ? { httpStatus: params.httpStatus } : {}),
    },
  };
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function extraText(posting: CanonicalPosting, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = posting.extra[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function normalizePublicApiPostings(params: {
  source: PublicApiSource;
  postings: CanonicalPosting[];
  rawResponseText: string;
  requestUrl: string;
  finalUrl: string;
  httpStatus: number;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
  warnings?: string[];
}): ConnectorFetchResult {
  const issues: ConnectorFetchResult['issues'] = (params.warnings ?? []).map((message) => ({
    safeId: null,
    code: 'invalid_shape' as const,
    message: message.slice(0, 500),
  }));
  const candidates: NormalizedSourcePosting[] = [];

  for (const posting of params.postings) {
    const canonicalUrl = canonicalizeUrl(posting.url);
    const titleRaw = posting.title.trim();
    const titleNormalized = normalizeJobTitle(titleRaw);
    const externalId = posting.externalId.trim() || canonicalUrl;
    if (!isHttpsUrl(canonicalUrl) || !titleRaw || !titleNormalized || !externalId) {
      issues.push({
        safeId: posting.externalId?.slice(0, 100) || null,
        code: 'invalid_shape',
        message: 'Posting lacked a stable HTTPS URL, title, or external identifier.',
      });
      continue;
    }

    const descriptionText = posting.rawText.trim() || null;
    const employerNameRaw = posting.employer.trim() || params.source.source_name;
    const employerNameNormalized = normalizeEmployerName(employerNameRaw);
    const locationRaw = posting.location.trim() || null;
    const locationNormalized = normalizeLocation(locationRaw);
    const employmentType = extraText(posting, 'employmentType', 'commitment');
    const department = extraText(posting, 'team');
    const remote = classifyRemoteType(titleRaw, locationRaw, descriptionText);
    const opportunity = classifyOpportunity(titleRaw, employmentType, descriptionText);
    const closesAt = dateOnly(posting.extra.closeDate);
    const postedAt = dateOnly(posting.postedAt);
    const uncertaintyFlags: UncertaintyFlag[] = [
      ...(locationRaw ? [] : ['location_missing' as const]),
      ...(descriptionText ? [] : ['description_missing' as const]),
      ...(closesAt ? [] : ['deadline_missing' as const]),
      'eligibility_missing',
      ...(employmentType ? [] : ['employment_type_missing' as const]),
      ...(opportunity.inferred ? ['classification_inferred' as const] : []),
      ...remote.flags,
    ];
    const scoreBreakdown = scoreIngestionCandidate({
      employerName: employerNameRaw,
      titleRaw,
      titleNormalized,
      locationNormalized,
      department,
      departments: department ? [department] : [],
      classification: opportunity.classification,
      remoteType: remote.remoteType,
      canonicalUrl,
      descriptionText,
      closesAt,
      uncertaintyFlags,
    });
    const materialFields = {
      titleRaw,
      locationRaw,
      canonicalUrl,
      department,
      employmentType,
      classification: opportunity.classification,
      remoteType: remote.remoteType,
      closesAt,
      descriptionText,
    };

    candidates.push({
      identityKey: `${params.source.source_kind}:${params.source.source_identifier ?? 'configured'}:${externalId}`,
      materialHash: sha256Hex(stableSerialize(materialFields)),
      connectorVersion: `${params.source.source_kind}/1.0.0`,
      sourceKind: params.source.source_kind,
      externalPostingId: externalId,
      internalJobId: null,
      requisitionId: extraText(posting, 'requisitionId'),
      employerNameRaw,
      employerNameNormalized,
      titleRaw,
      titleNormalized,
      locationRaw,
      locationNormalized,
      canonicalUrl,
      remoteType: remote.remoteType,
      employmentType,
      classification: opportunity.classification,
      department,
      departments: department ? [department] : [],
      offices: [],
      focusArea: scoreBreakdown.taxonomyClassification.lanes[0]?.label
        ?? inferFocusArea(titleRaw, descriptionText),
      postedAt,
      closesAt,
      deadlineKind: closesAt ? 'hard' : 'unknown',
      descriptionText,
      language: null,
      sourceUpdatedAt: posting.updatedAt,
      sourceMetadata: posting.extra,
      relevanceScore: scoreBreakdown.total,
      relevanceScoreVersion: SCORE_VERSION,
      scoreBreakdown,
      uncertaintyFlags: [...new Set(scoreBreakdown.uncertaintyFlags)],
      fetchedAt: params.fetchedAt,
    });
  }

  return {
    ok: true,
    candidates,
    rawResponseText: params.rawResponseText,
    requestUrl: params.requestUrl,
    finalUrl: params.finalUrl,
    httpStatus: params.httpStatus,
    contentType: 'application/json',
    etag: params.etag,
    lastModified: params.lastModified,
    fetchedAt: params.fetchedAt,
    recordsSeen: params.postings.length,
    recordsNormalized: candidates.length,
    recordsSkipped: params.postings.length - candidates.length,
    issues,
    error: null,
  };
}

export async function fetchPublicApiJobs(params: {
  source: PublicApiSource;
  fetcher?: PublicApiFetcher;
  usaJobsApiKey?: string;
  usaJobsRegisteredEmail?: string;
}): Promise<ConnectorFetchResult> {
  const fetchedAt = new Date().toISOString();
  const identifier = params.source.source_identifier?.trim();
  if (!identifier && !params.source.api_endpoint) {
    return failure({
      requestUrl: '', fetchedAt,
      message: `${params.source.source_kind} source requires a source identifier or API endpoint`,
    });
  }

  let requestUrl: string;
  try {
    requestUrl = params.source.api_endpoint?.trim()
      || getConnector(params.source.source_kind).listUrl(identifier!);
  } catch (error) {
    return failure({ requestUrl: '', fetchedAt, message: error instanceof Error ? error.message : String(error) });
  }

  let fetcher = params.fetcher;
  if (!fetcher && params.source.source_kind === 'usajobs') {
    if (!params.usaJobsApiKey || !params.usaJobsRegisteredEmail) {
      return failure({ requestUrl, fetchedAt, errorClass: 'auth', message: 'USAJOBS API credentials are not configured' });
    }
    fetcher = createUsaJobsFetcher({
      apiKey: params.usaJobsApiKey,
      registeredEmail: params.usaJobsRegisteredEmail,
    });
  }
  fetcher ??= (url, options) => safeFetch(url, options);

  let response: SafeFetchResponse;
  try {
    response = await fetcher(requestUrl, { etag: null, lastModified: null });
  } catch (error) {
    return failure({
      requestUrl, fetchedAt, errorClass: 'network', code: 'server_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (response.status === 304 || !('body' in response)) {
    return failure({ requestUrl, fetchedAt, message: 'API returned 304 without an archived body for this run' });
  }
  if (response.status < 200 || response.status >= 300) {
    return failure({
      requestUrl, fetchedAt, code: 'server_error', errorClass: 'network',
      message: `API request failed with HTTP ${response.status}`,
      httpStatus: response.status,
      rawResponseText: response.body,
    });
  }

  let parsed: ConnectorResult;
  try {
    parsed = getConnector(params.source.source_kind).parse(response.body, {
      employer: params.source.source_name,
      identifier: identifier ?? requestUrl,
    });
  } catch (error) {
    return failure({
      requestUrl, fetchedAt, code: 'invalid_shape', errorClass: 'schema',
      message: `API response parser failed: ${error instanceof Error ? error.message : String(error)}`,
      httpStatus: response.status, rawResponseText: response.body,
    });
  }
  if (parsed.postings.length === 0 && parsed.warnings.length > 0) {
    return failure({
      requestUrl, fetchedAt, code: 'invalid_shape',
      message: parsed.warnings[0], httpStatus: response.status, rawResponseText: response.body,
    });
  }
  return normalizePublicApiPostings({
    source: params.source,
    postings: parsed.postings,
    warnings: parsed.warnings,
    rawResponseText: response.body,
    requestUrl,
    finalUrl: response.finalUrl,
    httpStatus: response.status,
    etag: response.etag,
    lastModified: response.lastModified,
    fetchedAt,
  });
}
