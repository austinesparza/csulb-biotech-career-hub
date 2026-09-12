// Deliverable G (implementation) — CSV header mapping + row → OpportunityDraft.
// Parsing itself is done with papaparse in the server action; this module is pure.

import type { OpportunityDraft } from './types';
import {
  cleanText,
  normalizeCompanyName,
  normalizeTitle,
  normalizeTitleFamily,
  normalizeUrl,
  parseDeadline,
  parsePaidStatus,
} from './normalize';
import { deriveSheetAudienceDefaults } from './sheet-review';

/** Canonical fields the importer knows about. */
export type CanonicalField =
  | 'company_name' | 'title' | 'posting_url' | 'location' | 'eligibility'
  | 'focus_area' | 'deadline' | 'start_date_text' | 'paid_status'
  | 'application_type' | 'source_status_raw' | 'notes' | 'date_added'
  | 'candidate_id' | 'requisition' | 'work_pattern' | 'graduate_access'
  | 'continued_enrollment' | 'work_authorization' | 'key_evidence' | 'application_opened_at'
  | 'last_checked';

/** Header aliases, lowercase, punctuation-insensitive. Extend as spreadsheets evolve. */
const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  company_name: ['company name', 'company', 'organization', 'employer'],
  title: ['internship title position', 'internship title', 'position', 'title', 'role'],
  posting_url: ['link to posting', 'link', 'url', 'posting url', 'application link', 'source url'],
  location: ['location', 'city', 'location city'],
  eligibility: ['eligibility', 'requirements', 'who can apply', 'class standing', 'year program requirement'],
  focus_area: ['field focus area', 'focus area', 'field', 'area', 'category', 'career area'],
  deadline: ['application deadline', 'deadline', 'due date', 'apply by', 'stated close date'],
  start_date_text: ['start date duration', 'start date', 'duration', 'term', 'dates'],
  paid_status: ['paid unpaid', 'paid', 'compensation', 'pay'],
  application_type: ['application type', 'apply via', 'application method', 'program type'],
  source_status_raw: ['status', 'posting status', 'state', 'open status'],
  notes: ['notes', 'comments', 'additional info', 'officer notes'],
  date_added: ['date added', 'added', 'date entered'],
  candidate_id: ['candidate id'],
  requisition: ['requisition', 'requisition id', 'job id'],
  work_pattern: ['work pattern', 'work format', 'schedule format'],
  graduate_access: ['graduate access'],
  continued_enrollment: ['continued enrollment', 'return to school'],
  work_authorization: ['work authorization', 'sponsorship'],
  key_evidence: ['key evidence', 'eligibility evidence'],
  application_opened_at: ['posted date', 'application opened', 'opening date'],
  last_checked: ['last checked', 'checked date'],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const EMPTY_REVIEW_VALUE = /^(not (stated|provided|checked)|unknown|n\/?a|needs (source|officer))/i;

function reviewText(value: string): string | null {
  const text = cleanText(value);
  return text && !EMPTY_REVIEW_VALUE.test(text) ? text : null;
}

function parseContinuedEnrollment(value: string): boolean | null {
  const text = value.trim().toLowerCase();
  if (/^(required|yes|true)\b/.test(text)) return true;
  if (/^(not required|no|false)\b/.test(text)) return false;
  return null;
}

function sourceCheckResult(value: string, lastCheckedAt: string | null): OpportunityDraft['source_check_result'] {
  if (!lastCheckedAt) return 'unknown';
  const text = value.trim().toLowerCase();
  if (/^open\b/.test(text)) return 'open';
  if (/^closed\b/.test(text)) return 'closed';
  if (/^missing\b|not found|404/.test(text)) return 'missing';
  if (/^error\b/.test(text)) return 'error';
  return 'unknown';
}

/**
 * Map raw CSV headers to canonical fields. Returns the mapping plus any
 * unmatched headers so the admin UI can show a confirm screen before commit.
 */
export function mapHeaders(headers: string[]): {
  mapping: Partial<Record<CanonicalField, string>>;
  unmatched: string[];
} {
  const mapping: Partial<Record<CanonicalField, string>> = {};
  const unmatched: string[] = [];
  for (const header of headers) {
    const norm = normalizeHeader(header);
    const field = (Object.keys(HEADER_ALIASES) as CanonicalField[]).find(
      (f) => !mapping[f] && HEADER_ALIASES[f].some((a) => norm === a || norm.startsWith(a)),
    );
    if (field) mapping[field] = header;
    else unmatched.push(header);
  }
  return { mapping, unmatched };
}

export type RowResult =
  | { ok: true; draft: OpportunityDraft }
  | { ok: false; error: string };

/** Convert one raw CSV row (header → cell) into a validated draft. */
export function rowToDraft(
  raw: Record<string, string>,
  mapping: Partial<Record<CanonicalField, string>>,
): RowResult {
  const get = (f: CanonicalField): string =>
    mapping[f] ? (raw[mapping[f]!] ?? '') : '';

  const companyName = cleanText(get('company_name'));
  const title = cleanText(get('title'));
  if (!companyName && !title) return { ok: false, error: 'Empty row' };
  if (!companyName) return { ok: false, error: 'Missing company name' };
  if (!title) return { ok: false, error: 'Missing title' };

  const deadlineRaw = get('deadline');
  const urlRaw = get('posting_url');
  const url = urlRaw ? normalizeUrl(urlRaw) : null;

  const officerContext = [
    ['Candidate ID', get('candidate_id')],
    ['Requisition', get('requisition')],
    ['Work pattern', get('work_pattern')],
    ['Graduate access', get('graduate_access')],
    ['Continued enrollment', get('continued_enrollment')],
    ['Work authorization', get('work_authorization')],
    ['Key evidence', get('key_evidence')],
    ['Last checked', get('last_checked')],
  ]
    .map(([label, value]) => [label, cleanText(value)] as const)
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  const notes = cleanText(get('notes'));
  const privateNotes = [notes, ...officerContext].filter(Boolean).join('\n') || null;
  const audienceDefaults = deriveSheetAudienceDefaults({
    graduateAccess: get('graduate_access'),
    eligibility: get('eligibility'),
    keyEvidence: get('key_evidence'),
  });
  const lastCheckedAt = parseDeadline(get('last_checked'));

  const draft: OpportunityDraft = {
    companyName,
    title,
    posting_url: url,
    location: cleanText(get('location')),
    eligibility: cleanText(get('eligibility')),
    focus_area: cleanText(get('focus_area')),
    deadline: parseDeadline(deadlineRaw),
    deadline_text: cleanText(deadlineRaw),
    start_date_text: cleanText(get('start_date_text')),
    paid_status: parsePaidStatus(get('paid_status')),
    application_type: cleanText(get('application_type')),
    source_status_raw: cleanText(get('source_status_raw')),
    audience_bucket: audienceDefaults.audienceBucket,
    audience_reason: audienceDefaults.audienceReason || null,
    graduate_stage: audienceDefaults.graduateStage,
    eligibility_evidence: reviewText(get('key_evidence')),
    continued_enrollment_required: parseContinuedEnrollment(get('continued_enrollment')),
    work_authorization: reviewText(get('work_authorization')),
    application_opened_at: parseDeadline(get('application_opened_at')),
    last_checked_at: lastCheckedAt,
    source_check_result: sourceCheckResult(get('source_status_raw'), lastCheckedAt),
    // Spreadsheet notes are officer-facing until proven otherwise: PRIVATE by
    // default. The review UI lets an officer copy sanitized text to public_notes.
    private_notes: privateNotes,
    date_added: parseDeadline(get('date_added')),
    dedupe_key: makeStrictKey(companyName, title, url),
    family_key: makeFamilyKey(companyName, title),
  };
  return { ok: true, draft };
}

/**
 * Strict key: full normalized title (season/year KEPT) + URL when present.
 * Only strict matches may automatically update an existing row.
 */
export function makeStrictKey(companyName: string, title: string, url: string | null): string {
  return `${normalizeCompanyName(companyName)}|${normalizeTitle(title)}|${url ?? ''}`;
}

/**
 * Family key: season/year stripped. Matches across recurring cycles
 * ("Summer 2026" vs "Fall 2026") and is used ONLY to open possible_repost
 * review tasks — never for automatic updates.
 */
export function makeFamilyKey(companyName: string, title: string): string {
  return `${normalizeCompanyName(companyName)}|${normalizeTitleFamily(title)}`;
}
