import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteGoogleSheetRows,
  ensureGoogleSheetTab,
  fetchGoogleSheet,
  readGoogleSheetsConfig,
  writeGoogleSheet,
  type GoogleSheetValueUpdate,
  type SheetSnapshot,
} from './google-sheets';
import { normalizeUrl } from './normalize';

const MAX_SYNC_CANDIDATES = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REVIEW_QUEUE_HEADERS = [
  'Candidate ID', 'Review Status', 'Event Type', 'Employer', 'Role Title',
  'Requisition', 'Career Area', 'Program Type', 'Location', 'Work Pattern',
  'Posted Date', 'Stated Close Date', 'Open Status', 'Graduate Access',
  'Year / Program Requirement', 'Continued Enrollment', 'Work Authorization',
  'Key Evidence', 'Source URL', 'Last Checked', 'Officer Notes',
  'Publish Decision', 'Public Safe?', 'Supabase Record ID', 'GitHub Issue / PR',
  'Reviewer',
] as const;

const REVIEW_QUEUE_COLUMNS = REVIEW_QUEUE_HEADERS.length;

export interface ReviewSheetCandidate {
  id: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  scientific_lanes: string[] | null;
  deadline: string | null;
  deadline_text: string | null;
  application_type: string | null;
  source_status_raw: string | null;
  relevance_score: number | null;
  audience_bucket: string | null;
  audience_reason: string | null;
  eligibility_evidence: string | null;
  continued_enrollment_required: boolean | null;
  work_authorization: string | null;
  application_opened_at: string | null;
  last_checked_at: string | null;
  source_check_result: string | null;
  first_seen_at: string | null;
  companies: { name: string } | Array<{ name: string }> | null;
  opportunity_source_links?: Array<{
    source_postings: {
      canonical_url: string | null;
      external_posting_id: string | null;
      remote_type: string | null;
      posted_at: string | null;
    } | Array<{
      canonical_url: string | null;
      external_posting_id: string | null;
      remote_type: string | null;
      posted_at: string | null;
    }> | null;
  }>;
}

export interface ReviewSheetOpportunityState {
  id: string;
  status: string;
  review_status: string;
  public_safe: boolean;
}

export interface ReviewSheetArchivePlan {
  appendRows: string[][];
  deleteRowNumbers: number[];
  archived: number;
  alreadyArchived: number;
}

export interface ReviewSheetSyncPlan {
  updates: GoogleSheetValueUpdate[];
  appended: number;
  refreshed: number;
  linked: number;
  alreadyPresent: number;
}

export interface ReviewSheetSyncSummary {
  appended: number;
  refreshed: number;
  linked: number;
  alreadyPresent: number;
  totalMachineCandidates: number;
  archived: number;
  alreadyArchived: number;
  sheetRange: string;
  archiveRange: string;
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function headerIndex(headers: string[], label: string): number {
  const wanted = normalizeHeader(label);
  const index = headers.findIndex((header) => normalizeHeader(header) === wanted);
  if (index < 0) throw new Error(`Review Queue is missing the "${label}" column`);
  return index;
}

function safeSheetCell(value: unknown, maxLength = 1_500): string {
  const text = String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function stated(value: unknown, fallback = 'Not stated'): string {
  const text = safeSheetCell(value);
  return text || fallback;
}

function companyName(candidate: ReviewSheetCandidate): string {
  const relation = candidate.companies;
  if (Array.isArray(relation)) return relation[0]?.name ?? 'Unknown employer';
  return relation?.name ?? 'Unknown employer';
}

function graduateAccess(bucket: string | null): string {
  if (bucket === 'graduate' || bucket === 'mixed') return 'Explicit';
  if (bucket === 'undergraduate') return 'Undergraduate only';
  if (bucket && bucket !== 'unknown') return 'Out of scope';
  return 'Needs officer confirmation';
}

function continuedEnrollment(value: boolean | null): string {
  if (value === true) return 'Required';
  if (value === false) return 'Not required';
  return 'Not stated';
}

function checkedDate(candidate: ReviewSheetCandidate): string {
  if (!candidate.last_checked_at) return 'Not checked';
  const parsed = new Date(candidate.last_checked_at);
  return Number.isNaN(parsed.valueOf()) ? 'Not checked' : parsed.toISOString().slice(0, 10);
}

function sourcePosting(candidate: ReviewSheetCandidate) {
  const postings = (candidate.opportunity_source_links ?? []).flatMap((link) => {
    const relation = link.source_postings;
    return Array.isArray(relation) ? relation : relation ? [relation] : [];
  });
  const candidateUrl = candidate.posting_url ? normalizeUrl(candidate.posting_url) : null;
  return postings.find((posting) => (
    candidateUrl && posting.canonical_url && normalizeUrl(posting.canonical_url) === candidateUrl
  )) ?? postings.find((posting) => posting.external_posting_id) ?? postings[0] ?? null;
}

export function buildReviewSheetRow(
  candidate: ReviewSheetCandidate,
): string[] {
  const careerArea = candidate.scientific_lanes?.filter(Boolean).join('; ') || candidate.focus_area;
  const posting = sourcePosting(candidate);
  const openStatus = candidate.source_status_raw
    || (candidate.source_check_result && candidate.source_check_result !== 'unknown'
      ? candidate.source_check_result.replaceAll('_', ' ')
      : null);
  const row = [
    `AUTO-${candidate.id.slice(0, 8).toUpperCase()}`,
    'Needs review',
    'source_new',
    companyName(candidate),
    candidate.title,
    stated(posting?.external_posting_id, 'Not provided'),
    stated(careerArea, 'Needs classification'),
    stated(candidate.application_type, 'Internship or co-op, verify'),
    stated(candidate.location),
    stated(posting?.remote_type),
    stated(candidate.application_opened_at ?? posting?.posted_at),
    stated(candidate.deadline ?? candidate.deadline_text, 'Not stated or rolling'),
    stated(openStatus, 'Needs source check'),
    graduateAccess(candidate.audience_bucket),
    stated(candidate.eligibility, 'Needs officer verification'),
    continuedEnrollment(candidate.continued_enrollment_required),
    stated(candidate.work_authorization),
    stated(candidate.eligibility_evidence ?? candidate.audience_reason, 'Needs source-backed eligibility evidence'),
    stated(candidate.posting_url, 'Missing official URL'),
    checkedDate(candidate),
    'Added by the governed ingestion system. Review the official source before deciding.',
    '',
    'FALSE',
    candidate.id,
    '',
    '',
  ].map((value) => safeSheetCell(value));

  if (row.length !== REVIEW_QUEUE_COLUMNS) throw new Error('Review Queue row contract is invalid');
  return row;
}

function sheetReference(range: string): string {
  const bang = range.lastIndexOf('!');
  if (bang < 1) throw new Error('Google Sheet range must include a sheet name');
  return range.slice(0, bang);
}

function assertSheetHeaders(snapshot: SheetSnapshot, label: string): void {
  const headers = snapshot.rows[0] ?? [];
  for (let index = 0; index < REVIEW_QUEUE_COLUMNS; index += 1) {
    if (normalizeHeader(headers[index] ?? '') !== normalizeHeader(REVIEW_QUEUE_HEADERS[index])) {
      throw new Error(`${label} column ${index + 1} must be "${REVIEW_QUEUE_HEADERS[index]}"`);
    }
  }
}

export function planReviewSheetSync(
  snapshot: SheetSnapshot,
  candidates: ReviewSheetCandidate[],
): ReviewSheetSyncPlan {
  assertSheetHeaders(snapshot, 'Review Queue');
  const headers = snapshot.rows[0] ?? [];
  const candidateIdColumn = headerIndex(headers, 'Candidate ID');
  const urlColumn = headerIndex(headers, 'Source URL');
  const recordIdColumn = headerIndex(headers, 'Supabase Record ID');
  const sheetRef = sheetReference(snapshot.range);
  const rangeEndRow = Number(snapshot.range.match(/:[A-Z]+(\d+)$/i)?.[1] ?? snapshot.rows.length);

  const byId = new Map<string, { rowNumber: number; candidateId: string }>();
  const byUrl = new Map<string, { rowNumber: number; recordId: string; candidateId: string }>();
  for (let index = 1; index < snapshot.rows.length; index += 1) {
    const row = snapshot.rows[index] ?? [];
    const rowNumber = index + 1;
    const recordId = String(row[recordIdColumn] ?? '').trim();
    const sourceUrl = normalizeUrl(String(row[urlColumn] ?? ''));
    const candidateId = String(row[candidateIdColumn] ?? '').trim();
    if (recordId) byId.set(recordId, { rowNumber, candidateId });
    if (sourceUrl && !byUrl.has(sourceUrl)) byUrl.set(sourceUrl, { rowNumber, recordId, candidateId });
  }

  const updates: GoogleSheetValueUpdate[] = [];
  const freeRowNumbers: number[] = [];
  for (let rowNumber = 2; rowNumber <= rangeEndRow; rowNumber += 1) {
    const row = snapshot.rows[rowNumber - 1] ?? [];
    const reusable = row.every((value, column) => {
      const text = String(value ?? '').trim();
      return !text || (column === 22 && text.toUpperCase() === 'FALSE');
    });
    if (reusable) freeRowNumbers.push(rowNumber);
  }
  let nextFreeRow = 0;
  let appended = 0;
  let refreshed = 0;
  let linked = 0;
  let alreadyPresent = 0;

  for (const candidate of candidates.slice(0, MAX_SYNC_CANDIDATES)) {
    const row = buildReviewSheetRow(candidate);
    const byRecord = byId.get(candidate.id);
    if (byRecord) {
      if (byRecord.candidateId.startsWith('AUTO-')) {
        updates.push({ range: `${sheetRef}!A${byRecord.rowNumber}:T${byRecord.rowNumber}`, values: [row.slice(0, 20)] });
        updates.push({ range: `${sheetRef}!X${byRecord.rowNumber}:X${byRecord.rowNumber}`, values: [[candidate.id]] });
        refreshed += 1;
      } else {
        alreadyPresent += 1;
      }
      continue;
    }

    const sourceUrl = candidate.posting_url ? normalizeUrl(candidate.posting_url) : null;
    const bySourceUrl = sourceUrl ? byUrl.get(sourceUrl) : undefined;
    if (bySourceUrl) {
      if (!bySourceUrl.recordId) {
        updates.push({ range: `${sheetRef}!X${bySourceUrl.rowNumber}:X${bySourceUrl.rowNumber}`, values: [[candidate.id]] });
        linked += 1;
      } else {
        alreadyPresent += 1;
      }
      continue;
    }
    const rowNumber = freeRowNumbers[nextFreeRow];
    if (!rowNumber) {
      throw new Error(`Review Queue has no empty candidate rows within ${snapshot.range}`);
    }
    nextFreeRow += 1;
    updates.push({ range: `${sheetRef}!A${rowNumber}:Z${rowNumber}`, values: [row] });
    appended += 1;
  }

  return { updates, appended, refreshed, linked, alreadyPresent };
}

function archiveReviewLabel(state: ReviewSheetOpportunityState): string {
  if (state.review_status === 'rejected') return 'Rejected';
  if (state.status === 'archive_only') return 'Archived outside board';
  if (state.status === 'duplicate') return 'Duplicate';
  if (state.status === 'hidden') return 'Hidden';
  if (state.status === 'not_relevant') return 'Rejected as not relevant';
  if (state.status === 'closed' || state.status === 'expired') return 'Closed';
  if (state.review_status === 'approved') return 'Approved';
  return 'Resolved';
}

export function planResolvedRowArchive(
  reviewSnapshot: SheetSnapshot,
  archiveSnapshot: SheetSnapshot,
  states: ReviewSheetOpportunityState[],
): ReviewSheetArchivePlan {
  assertSheetHeaders(reviewSnapshot, 'Review Queue');
  assertSheetHeaders(archiveSnapshot, 'Archive');
  const reviewHeaders = reviewSnapshot.rows[0] ?? [];
  const archiveHeaders = archiveSnapshot.rows[0] ?? [];
  const reviewRecordIdColumn = headerIndex(reviewHeaders, 'Supabase Record ID');
  const reviewStatusColumn = headerIndex(reviewHeaders, 'Review Status');
  const decisionColumn = headerIndex(reviewHeaders, 'Publish Decision');
  const publicSafeColumn = headerIndex(reviewHeaders, 'Public Safe?');
  const archiveRecordIdColumn = headerIndex(archiveHeaders, 'Supabase Record ID');
  const stateById = new Map(states.map((state) => [state.id, state]));
  const archivedIds = new Set(
    archiveSnapshot.rows.slice(1).map((row) => String(row[archiveRecordIdColumn] ?? '').trim()).filter(Boolean),
  );

  const appendRows: string[][] = [];
  const deleteRowNumbers: number[] = [];
  let archived = 0;
  let alreadyArchived = 0;

  for (let index = 1; index < reviewSnapshot.rows.length; index += 1) {
    const sourceRow = reviewSnapshot.rows[index] ?? [];
    const recordId = String(sourceRow[reviewRecordIdColumn] ?? '').trim();
    if (!recordId || !UUID_PATTERN.test(recordId)) continue;
    const state = stateById.get(recordId);
    if (!state || state.status === 'needs_review') continue;

    deleteRowNumbers.push(index + 1);
    if (archivedIds.has(recordId)) {
      alreadyArchived += 1;
      continue;
    }

    const row = Array.from({ length: REVIEW_QUEUE_COLUMNS }, (_, column) => safeSheetCell(sourceRow[column] ?? ''));
    row[reviewStatusColumn] = archiveReviewLabel(state);
    row[decisionColumn] = state.review_status === 'approved' && state.public_safe
      ? 'Approve'
      : state.review_status === 'rejected' || state.status === 'not_relevant'
        ? 'Reject'
        : row[decisionColumn];
    row[publicSafeColumn] = state.public_safe ? 'TRUE' : 'FALSE';
    appendRows.push(row);
    archivedIds.add(recordId);
    archived += 1;
  }

  return { appendRows, deleteRowNumbers, archived, alreadyArchived };
}

export async function syncReviewQueueToGoogleSheet({ db }: { db: SupabaseClient }): Promise<ReviewSheetSyncSummary> {
  const config = readGoogleSheetsConfig();
  if (!config) throw new Error('Google Sheets review queue is not configured');

  const { data: candidates, error: candidatesError } = await db
    .from('opportunities')
    .select(
      'id,title,posting_url,location,eligibility,focus_area,scientific_lanes,deadline,deadline_text,application_type,' +
      'source_status_raw,relevance_score,audience_bucket,audience_reason,eligibility_evidence,continued_enrollment_required,' +
      'work_authorization,application_opened_at,last_checked_at,source_check_result,first_seen_at,companies(name),' +
      'opportunity_source_links(source_postings(canonical_url,external_posting_id,remote_type,posted_at))',
    )
    .eq('status', 'needs_review')
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .limit(MAX_SYNC_CANDIDATES);
  if (candidatesError) throw new Error(candidatesError.message);

  const [reviewSnapshot, archiveSnapshot] = await Promise.all([
    fetchGoogleSheet(config),
    ensureGoogleSheetTab({
      config,
      title: 'Archive',
      rows: 5_000,
      cols: REVIEW_QUEUE_COLUMNS,
      headers: [...REVIEW_QUEUE_HEADERS],
    }),
  ]);

  const reviewStates = (reviewSnapshot.rows.slice(1)
    .map((row) => String(row[23] ?? '').trim())
    .filter((id) => UUID_PATTERN.test(id)));
  let states: ReviewSheetOpportunityState[] = [];
  if (reviewStates.length > 0) {
    const { data: stateRows, error: stateError } = await db
      .from('opportunities')
      .select('id,status,review_status,public_safe')
      .in('id', reviewStates);
    if (stateError) throw new Error(stateError.message);
    states = (stateRows ?? []) as ReviewSheetOpportunityState[];
  }

  const archivePlan = planResolvedRowArchive(reviewSnapshot, archiveSnapshot, states);
  if (archivePlan.appendRows.length > 0) {
    const firstEmpty = Math.max(archiveSnapshot.rows.length + 1, 2);
    await writeGoogleSheet({
      config,
      updates: [{
        range: `'Archive'!A${firstEmpty}:Z${firstEmpty + archivePlan.appendRows.length - 1}`,
        values: archivePlan.appendRows,
      }],
    });
  }
  if (archivePlan.deleteRowNumbers.length > 0) {
    await deleteGoogleSheetRows({
      config,
      tabTitle: config.tabName,
      rowNumbers: archivePlan.deleteRowNumbers,
    });
  }

  const refreshedReviewSnapshot = archivePlan.deleteRowNumbers.length > 0
    ? await fetchGoogleSheet(config)
    : reviewSnapshot;
  const syncPlan = planReviewSheetSync(
    refreshedReviewSnapshot,
    (candidates ?? []) as unknown as ReviewSheetCandidate[],
  );
  if (syncPlan.updates.length > 0) await writeGoogleSheet({ config, updates: syncPlan.updates });

  return {
    ...syncPlan,
    totalMachineCandidates: candidates?.length ?? 0,
    archived: archivePlan.archived,
    alreadyArchived: archivePlan.alreadyArchived,
    sheetRange: config.range,
    archiveRange: archiveSnapshot.range,
  };
}
