import type { AudienceBucket, GraduateStage } from './types';

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function cell(raw: Record<string, unknown>, aliases: string[]): string {
  const wanted = new Set(aliases.map(normalizeHeader));
  const entry = Object.entries(raw).find(([header]) => wanted.has(normalizeHeader(header)));
  return entry ? String(entry[1] ?? '').trim() : '';
}

function affirmative(value: string): boolean {
  return ['true', 'yes', 'y', '1', 'checked'].includes(value.toLowerCase());
}

export interface SheetAudienceDefaults {
  audienceBucket: AudienceBucket;
  audienceReason: string;
  graduateStage: GraduateStage;
}

export interface SheetReviewIntent extends SheetAudienceDefaults {
  decision: 'approve' | 'reject' | null;
  publicSafe: boolean;
  reviewer: string | null;
}

export interface MeaningfulSheetRows {
  rows: string[][];
  candidateRows: number;
  skippedTemplateRows: number;
}

/**
 * Ignore unused preformatted rows whose only values are defaults such as an
 * unchecked Public Safe checkbox. Partially completed candidates remain so the
 * importer can report a precise validation error.
 */
export function filterMeaningfulReviewRows(rows: string[][]): MeaningfulSheetRows {
  const headers = rows[0] ?? [];
  if (headers.length === 0) return { rows: [], candidateRows: 0, skippedTemplateRows: 0 };
  const candidateHeaders = new Set([
    'candidate id', 'employer', 'company', 'company name', 'role title', 'title',
    'position', 'source url', 'posting url', 'application link',
  ]);
  const indexes = headers
    .map((header, index) => candidateHeaders.has(normalizeHeader(header)) ? index : -1)
    .filter((index) => index >= 0);
  if (indexes.length === 0) throw new Error('Review Queue is missing candidate identity columns');

  const dataRows = rows.slice(1);
  const meaningful = dataRows.filter((row) => indexes.some((index) => String(row[index] ?? '').trim()));
  return {
    rows: [headers, ...meaningful],
    candidateRows: meaningful.length,
    skippedTemplateRows: dataRows.length - meaningful.length,
  };
}

export function deriveSheetAudienceDefaults(input: {
  graduateAccess?: string | null;
  eligibility?: string | null;
  keyEvidence?: string | null;
}): SheetAudienceDefaults {
  const graduateAccess = input.graduateAccess?.trim() ?? '';
  const eligibility = input.eligibility?.trim() ?? '';
  const keyEvidence = input.keyEvidence?.trim() ?? '';
  const combined = `${graduateAccess} ${eligibility} ${keyEvidence}`.toLowerCase();

  const hasMasters = /\bmaster(?:'s|s)?\b|\bmsc\b|\bmba\b|\bpharmd\b/.test(combined);
  const hasDoctoral = /\bph\.?d\.?\b|\bdoctoral\b|\bdoctorate\b/.test(combined);
  const hasUndergraduate = /\bundergraduate\b|\bbachelor(?:'s|s)?\b/.test(combined);

  let audienceBucket: AudienceBucket = 'unknown';
  if (hasMasters) audienceBucket = hasUndergraduate ? 'mixed' : 'graduate';

  let graduateStage: GraduateStage = 'unknown';
  if (hasMasters && (
    /first (?:program|academic) year (?:must be )?completed/.test(combined)
    || /completed (?:the )?first (?:program|academic) year/.test(combined)
    || /second[- ]year master/.test(combined)
  )) {
    graduateStage = 'msc_year_2';
  } else if (hasMasters && /first[- ]year master/.test(combined)) {
    graduateStage = 'msc_year_1';
  } else if (hasMasters && /any (?:master(?:'s)?|graduate) year/.test(combined)) {
    graduateStage = 'msc_any';
  } else if (hasMasters && hasDoctoral) {
    graduateStage = 'mixed_graduate';
  } else if (hasMasters) {
    graduateStage = 'graduate_unspecified';
  } else if (hasDoctoral) {
    graduateStage = 'doctoral_only';
  }

  return {
    audienceBucket,
    audienceReason: keyEvidence || eligibility || graduateAccess,
    graduateStage,
  };
}

export function readSheetReviewIntent(raw: Record<string, unknown>): SheetReviewIntent {
  const decisionText = cell(raw, ['Publish Decision', 'Review Decision']).toLowerCase();
  const decision = decisionText.startsWith('approve')
    ? 'approve'
    : decisionText.startsWith('reject')
      ? 'reject'
      : null;
  const defaults = deriveSheetAudienceDefaults({
    graduateAccess: cell(raw, ['Graduate Access']),
    eligibility: cell(raw, ['Year / Program Requirement', 'Eligibility']),
    keyEvidence: cell(raw, ['Key Evidence', 'Eligibility Evidence']),
  });

  return {
    ...defaults,
    decision,
    publicSafe: affirmative(cell(raw, ['Public Safe?', 'Public Safe'])),
    reviewer: cell(raw, ['Reviewer']) || null,
  };
}
