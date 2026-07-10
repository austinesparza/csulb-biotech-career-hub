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

/** Canonical fields the importer knows about. */
export type CanonicalField =
  | 'company_name' | 'title' | 'posting_url' | 'location' | 'eligibility'
  | 'focus_area' | 'deadline' | 'start_date_text' | 'paid_status'
  | 'application_type' | 'source_status_raw' | 'notes' | 'date_added';

/** Header aliases, lowercase, punctuation-insensitive. Extend as spreadsheets evolve. */
const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  company_name: ['company name', 'company', 'organization', 'employer'],
  title: ['internship title position', 'internship title', 'position', 'title', 'role'],
  posting_url: ['link to posting', 'link', 'url', 'posting url', 'application link'],
  location: ['location', 'city', 'location city'],
  eligibility: ['eligibility', 'requirements', 'who can apply', 'class standing'],
  focus_area: ['field focus area', 'focus area', 'field', 'area', 'category'],
  deadline: ['application deadline', 'deadline', 'due date', 'apply by'],
  start_date_text: ['start date duration', 'start date', 'duration', 'term', 'dates'],
  paid_status: ['paid unpaid', 'paid', 'compensation', 'pay'],
  application_type: ['application type', 'apply via', 'application method'],
  source_status_raw: ['status', 'posting status', 'state'],
  notes: ['notes', 'comments', 'additional info'],
  date_added: ['date added', 'added', 'date entered'],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
    // Spreadsheet notes are officer-facing until proven otherwise: PRIVATE by
    // default. The review UI lets an officer copy sanitized text to public_notes.
    private_notes: cleanText(get('notes')),
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
