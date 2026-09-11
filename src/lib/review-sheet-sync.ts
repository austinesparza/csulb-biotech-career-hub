import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchGoogleSheet,
  readGoogleSheetsConfig,
  writeGoogleSheet,
  type GoogleSheetValueUpdate,
  type SheetSnapshot,
} from './google-sheets';

const MAX_SYNC_CANDIDATES = 50;
const REVIEW_QUEUE_COLUMNS = 25;

export interface ReviewSheetCandidate {
  id: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  application_type: string | null;
  source_status_raw: string | null;
  relevance_score: number | null;
  audience_bucket: string | null;
  audience_reason: string | null;
  companies: { name: string } | Array<{ name: string }> | null;
}

export interface ReviewSheetSyncPlan {
  updates: GoogleSheetValueUpdate[];
  appendRows: string[][];
  appended: number;
  refreshed: number;
  linked: number;
  alreadyPresent: number;
}

export interface ReviewSheetSyncSummary extends ReviewSheetSyncPlan {
  totalMachineCandidates: number;
  sheetRange: string;
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

function companyName(candidate: ReviewSheetCandidate): string {
  const relation = candidate.companies;
  if (Array.isArray(relation)) return relation[0]?.name ?? 'Unknown employer';
  return relation?.name ?? 'Unknown employer';
}

function graduateAccess(bucket: string | null): string {
  if (bucket === 'graduate' || bucket === 'mixed') return 'Explicit';
  if (bucket && bucket !== 'unknown') return 'Out of scope';
  return 'Needs officer confirmation';
}

export function buildReviewSheetRow(
  candidate: ReviewSheetCandidate,
  checkedAt: Date = new Date(),
): string[] {
  const row = [
    `AUTO-${candidate.id.slice(0, 8).toUpperCase()}`,
    'Needs review',
    'source_new',
    companyName(candidate),
    candidate.title,
    '',
    candidate.focus_area,
    candidate.application_type,
    candidate.location,
    '',
    '',
    candidate.deadline ?? candidate.deadline_text,
    candidate.source_status_raw || 'Open',
    graduateAccess(candidate.audience_bucket),
    candidate.eligibility,
    '',
    '',
    candidate.audience_reason || 'Automated discovery. Verify role-level eligibility against the official posting.',
    candidate.posting_url,
    checkedAt.toISOString().slice(0, 10),
    'Added by the governed ingestion system. Review the official source before deciding.',
    '',
    'FALSE',
    candidate.id,
    '',
  ].map((value) => safeSheetCell(value));

  if (row.length !== REVIEW_QUEUE_COLUMNS) {
    throw new Error('Review Queue row contract is invalid');
  }
  return row;
}

function sheetReference(range: string): string {
  const bang = range.lastIndexOf('!');
  if (bang < 1) throw new Error('GOOGLE_SHEETS_RANGE must include the Review Queue sheet name');
  return range.slice(0, bang);
}

export function planReviewSheetSync(
  snapshot: SheetSnapshot,
  candidates: ReviewSheetCandidate[],
  checkedAt: Date = new Date(),
): ReviewSheetSyncPlan {
  const headers = snapshot.rows[0] ?? [];
  if (headers.length < REVIEW_QUEUE_COLUMNS) {
    throw new Error('Review Queue must expose columns A through Y');
  }

  const candidateIdColumn = headerIndex(headers, 'Candidate ID');
  const urlColumn = headerIndex(headers, 'Source URL');
  const recordIdColumn = headerIndex(headers, 'Supabase Record ID');
  const sheetRef = sheetReference(snapshot.range);

  const byId = new Map<string, { rowNumber: number; candidateId: string }>();
  const byUrl = new Map<string, { rowNumber: number; recordId: string; candidateId: string }>();
  for (let index = 1; index < snapshot.rows.length; index += 1) {
    const row = snapshot.rows[index] ?? [];
    const rowNumber = index + 1;
    const recordId = String(row[recordIdColumn] ?? '').trim();
    const sourceUrl = String(row[urlColumn] ?? '').trim();
    const candidateId = String(row[candidateIdColumn] ?? '').trim();
    if (recordId) byId.set(recordId, { rowNumber, candidateId });
    if (sourceUrl && !byUrl.has(sourceUrl)) {
      byUrl.set(sourceUrl, { rowNumber, recordId, candidateId });
    }
  }

  const updates: GoogleSheetValueUpdate[] = [];
  const appendRows: string[][] = [];
  let refreshed = 0;
  let linked = 0;
  let alreadyPresent = 0;

  for (const candidate of candidates.slice(0, MAX_SYNC_CANDIDATES)) {
    const row = buildReviewSheetRow(candidate, checkedAt);
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

    const sourceUrl = candidate.posting_url?.trim() ?? '';
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

    appendRows.push(row);
  }

  return {
    updates,
    appendRows,
    appended: appendRows.length,
    refreshed,
    linked,
    alreadyPresent,
  };
}

export async function syncReviewQueueToGoogleSheet(params: {
  db: SupabaseClient;
  limit?: number;
  checkedAt?: Date;
}): Promise<ReviewSheetSyncSummary> {
  const limit = params.limit ?? MAX_SYNC_CANDIDATES;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SYNC_CANDIDATES) {
    throw new Error(`Sheet sync limit must be an integer from 1 to ${MAX_SYNC_CANDIDATES}`);
  }

  const config = readGoogleSheetsConfig();
  const snapshot = await fetchGoogleSheet(config);
  const { data, count, error } = await params.db
    .from('opportunities')
    .select(
      'id, title, posting_url, location, eligibility, focus_area, deadline, deadline_text, ' +
      'application_type, source_status_raw, relevance_score, audience_bucket, audience_reason, ' +
      'companies(name), opportunity_source_links!inner(source_posting_id)',
      { count: 'exact' },
    )
    .eq('status', 'needs_review')
    .order('relevance_score', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`Could not load machine review candidates: ${error.message}`);

  const candidates = (data ?? []) as unknown as ReviewSheetCandidate[];
  const plan = planReviewSheetSync(snapshot, candidates, params.checkedAt);
  await writeGoogleSheet(config, {
    updates: plan.updates,
    appendRows: plan.appendRows,
  });

  return {
    ...plan,
    totalMachineCandidates: count ?? candidates.length,
    sheetRange: snapshot.range,
  };
}
