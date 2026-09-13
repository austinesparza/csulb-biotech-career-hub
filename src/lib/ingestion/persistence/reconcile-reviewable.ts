import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeUrl } from '../../normalize';
import type {
  DeadlineKind,
  NormalizedSourcePosting,
  OpportunityClassification,
  RemoteType,
  ScoreBreakdown,
  SourceKind,
  UncertaintyFlag,
} from '../types';
import {
  bridgeOpportunityForSourcePosting,
  PENDING_OPPORTUNITY_MIN_SCORE,
} from './opportunity-bridge';
import {
  createSupabaseIngestionRepository,
  type SourcePostingRow,
} from './repository';

const SOURCE_KINDS = new Set<SourceKind>([
  'greenhouse', 'lever', 'ashby', 'usajobs', 'schema_org', 'static_html', 'rss', 'other_api',
]);
const REMOTE_TYPES = new Set<RemoteType>(['remote', 'hybrid', 'onsite', 'unknown']);
const CLASSIFICATIONS = new Set<OpportunityClassification>(['internship', 'entry_level', 'fellowship', 'research', 'other']);
const DEADLINE_KINDS = new Set<DeadlineKind>(['hard', 'rolling', 'unknown']);

interface PersistedPosting extends SourcePostingRow {
  external_posting_id: string | null;
  employer_name_raw: string | null;
  employer_name_normalized: string | null;
  title_raw: string | null;
  title_normalized: string | null;
  location_raw: string | null;
  location_normalized: string | null;
  remote_type: string | null;
  employment_type: string | null;
  classification: string | null;
  department: string | null;
  focus_area: string | null;
  posted_at: string | null;
  closes_at: string | null;
  deadline_kind: string | null;
  score_breakdown_json: Record<string, unknown> | null;
  uncertainty_flags: string[] | null;
}

interface PersistedVersion {
  source_posting_id: string;
  connector_version: string;
  normalized_json: Record<string, unknown> | null;
  score_breakdown_json: Record<string, unknown> | null;
  created_at: string;
}

interface LinkWithOpportunity {
  source_posting_id: string;
  opportunities: { posting_url: string | null } | Array<{ posting_url: string | null }> | null;
}

export interface ReviewableSourceReconciliationSummary {
  considered: number;
  alreadyMaterialized: number;
  missingMaterialization: number;
  repaired: number;
  skippedMissingVersion: number;
  errors: string[];
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function relationPostingUrl(link: LinkWithOpportunity): string | null {
  const relation = link.opportunities;
  if (Array.isArray(relation)) return relation[0]?.posting_url ?? null;
  return relation?.posting_url ?? null;
}

export function hasExactMaterialization(postingUrl: string, links: LinkWithOpportunity[]): boolean {
  const normalizedPostingUrl = normalizeUrl(postingUrl);
  if (!normalizedPostingUrl) return false;
  return links.some((link) => {
    const opportunityUrl = relationPostingUrl(link);
    return opportunityUrl ? normalizeUrl(opportunityUrl) === normalizedPostingUrl : false;
  });
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  return typeof value === 'string' && allowed.has(value as T) ? value as T : fallback;
}

function scoreBreakdown(
  value: Record<string, unknown> | null,
  version: number,
  score: number,
  uncertaintyFlags: UncertaintyFlag[],
): ScoreBreakdown {
  if (value && typeof value === 'object') return value as unknown as ScoreBreakdown;
  return {
    version,
    total: score,
    rawTotal: score,
    positiveReasons: [],
    negativeReasons: [],
    uncertaintyFlags,
  };
}

export function rehydrateNormalizedPosting(
  row: PersistedPosting,
  version: PersistedVersion,
): NormalizedSourcePosting {
  const snapshot = version.normalized_json ?? {};
  const sourceKindRaw = row.identity_key.split(':', 1)[0];
  if (!SOURCE_KINDS.has(sourceKindRaw as SourceKind)) {
    throw new Error(`Unsupported persisted source kind for posting ${row.id}`);
  }
  const sourceKind = sourceKindRaw as SourceKind;
  const relevanceScore = row.relevance_score ?? 0;
  const relevanceScoreVersion = row.relevance_score_version ?? 1;
  const uncertaintyFlags = (row.uncertainty_flags ?? []) as UncertaintyFlag[];

  return {
    identityKey: row.identity_key,
    materialHash: row.last_material_hash,
    connectorVersion: version.connector_version,
    sourceKind,
    externalPostingId: row.external_posting_id,
    internalJobId: text(snapshot.internalJobId),
    requisitionId: text(snapshot.requisitionId),
    employerNameRaw: row.employer_name_raw,
    employerNameNormalized: row.employer_name_normalized,
    titleRaw: row.title_raw,
    titleNormalized: row.title_normalized,
    locationRaw: row.location_raw,
    locationNormalized: row.location_normalized,
    canonicalUrl: row.canonical_url,
    remoteType: enumValue(row.remote_type, REMOTE_TYPES, 'unknown'),
    employmentType: row.employment_type,
    classification: enumValue(row.classification, CLASSIFICATIONS, 'other'),
    department: row.department,
    departments: stringArray(snapshot.departments),
    offices: stringArray(snapshot.offices),
    focusArea: row.focus_area,
    postedAt: row.posted_at,
    closesAt: row.closes_at,
    deadlineKind: enumValue(row.deadline_kind, DEADLINE_KINDS, 'unknown'),
    deadlineEvidence: text(snapshot.deadlineEvidence),
    descriptionText: text(snapshot.descriptionText),
    language: text(snapshot.language),
    sourceUpdatedAt: text(snapshot.sourceUpdatedAt),
    sourceMetadata: snapshot.sourceMetadata ?? null,
    relevanceScore,
    relevanceScoreVersion,
    scoreBreakdown: scoreBreakdown(version.score_breakdown_json ?? row.score_breakdown_json, relevanceScoreVersion, relevanceScore, uncertaintyFlags),
    uncertaintyFlags,
    fetchedAt: row.last_seen_at,
  };
}

/**
 * Repair the curated-layer bridge for reviewable source postings before a Sheet
 * push. This is intentionally idempotent. A source posting is considered fully
 * materialized only when it is linked to an opportunity with the same canonical
 * posting URL. Probable/family links do not suppress a distinct posting.
 */
export async function reconcileReviewableSourcePostings(params: {
  db: SupabaseClient;
  limit?: number;
}): Promise<ReviewableSourceReconciliationSummary> {
  const limit = params.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Source reconciliation limit must be an integer from 1 to 100');
  }

  const { data: postingData, error: postingError } = await params.db.from('source_postings')
    .select(
      'id, job_source_id, identity_key, canonical_url, external_posting_id, employer_name_raw, employer_name_normalized, ' +
      'title_raw, title_normalized, location_raw, location_normalized, remote_type, employment_type, classification, ' +
      'department, focus_area, posted_at, closes_at, deadline_kind, current_status, relevance_score, relevance_score_version, ' +
      'score_breakdown_json, uncertainty_flags, first_seen_at, last_seen_at, last_material_hash',
    )
    .gte('relevance_score', PENDING_OPPORTUNITY_MIN_SCORE)
    .in('current_status', ['open', 'reopened', 'unknown'])
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (postingError) throw new Error(`Could not load reviewable source postings: ${postingError.message}`);

  const postings = (postingData ?? []) as unknown as PersistedPosting[];
  if (postings.length === 0) {
    return {
      considered: 0,
      alreadyMaterialized: 0,
      missingMaterialization: 0,
      repaired: 0,
      skippedMissingVersion: 0,
      errors: [],
    };
  }

  const postingIds = postings.map((posting) => posting.id);
  const [{ data: linkData, error: linkError }, { data: versionData, error: versionError }] = await Promise.all([
    params.db.from('opportunity_source_links')
      .select('source_posting_id, opportunities(posting_url)')
      .in('source_posting_id', postingIds),
    params.db.from('source_posting_versions')
      .select('source_posting_id, connector_version, normalized_json, score_breakdown_json, created_at')
      .in('source_posting_id', postingIds)
      .order('created_at', { ascending: false }),
  ]);
  if (linkError) throw new Error(`Could not load opportunity/source links: ${linkError.message}`);
  if (versionError) throw new Error(`Could not load source posting versions: ${versionError.message}`);

  const linksByPosting = new Map<string, LinkWithOpportunity[]>();
  for (const raw of (linkData ?? []) as unknown as LinkWithOpportunity[]) {
    const links = linksByPosting.get(raw.source_posting_id) ?? [];
    links.push(raw);
    linksByPosting.set(raw.source_posting_id, links);
  }

  const latestVersionByPosting = new Map<string, PersistedVersion>();
  for (const raw of (versionData ?? []) as unknown as PersistedVersion[]) {
    if (!latestVersionByPosting.has(raw.source_posting_id)) latestVersionByPosting.set(raw.source_posting_id, raw);
  }

  const missing = postings.filter((posting) => !hasExactMaterialization(
    posting.canonical_url,
    linksByPosting.get(posting.id) ?? [],
  ));
  const repository = createSupabaseIngestionRepository({ db: params.db, storage: params.db.storage });
  let repaired = 0;
  let skippedMissingVersion = 0;
  const errors: string[] = [];

  for (const posting of missing) {
    const version = latestVersionByPosting.get(posting.id);
    if (!version) {
      skippedMissingVersion += 1;
      continue;
    }

    try {
      const jobSource = await repository.getJobSource(posting.job_source_id);
      if (!jobSource) {
        errors.push(`Source posting ${posting.id.slice(0, 8)} has no job source.`);
        continue;
      }
      const normalized = rehydrateNormalizedPosting(posting, version);
      const result = await bridgeOpportunityForSourcePosting({
        repository,
        jobSource,
        sourcePosting: posting,
        posting: normalized,
        materialChanged: false,
      });
      if (result.linkedOpportunityId) repaired += 1;
    } catch (error) {
      console.error('[source-reconciliation] bridge repair failed', {
        sourcePostingId: posting.id,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      errors.push(`Could not repair source posting ${posting.id.slice(0, 8)}.`);
    }
  }

  return {
    considered: postings.length,
    alreadyMaterialized: postings.length - missing.length,
    missingMaterialization: missing.length,
    repaired,
    skippedMissingVersion,
    errors,
  };
}
