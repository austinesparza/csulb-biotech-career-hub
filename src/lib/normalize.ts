// Field normalization: turn messy spreadsheet strings into clean typed values.
// Pure functions, no imports — unit-testable in isolation.

import type { PaidStatus } from './types';

const COMPANY_SUFFIXES =
  /\b(inc|incorporated|llc|ltd|corp|corporation|co|company|plc|gmbh)\.?$/i;

/** Lowercase, trim, collapse whitespace, strip punctuation and legal suffixes. */
export function normalizeCompanyName(name: string): string {
  let s = name.trim().toLowerCase().replace(/[.,'"()]/g, '').replace(/\s+/g, ' ');
  s = s.replace(COMPANY_SUFFIXES, '').trim();
  return s;
}

/** Full title normalization. KEEPS season/year so distinct cycles stay distinct. */
export function normalizeTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[–—-]/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Family form: season/year stripped. Used ONLY to flag possible reposts for
 * review — never for automatic updates ("Summer 2026" vs "Fall 2026" are
 * different postings).
 */
export function normalizeTitleFamily(title: string): string {
  return normalizeTitle(title)
    .replace(/\b(20\d{2}|spring|summer|fall|winter)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonicalize URL: require http(s), lowercase host, strip tracking params,
 * trailing slash, fragments. Returns null for anything unparseable or non-HTTP.
 */
export function normalizeUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  const withScheme = raw.includes('://') ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null; // flagged as needs review by caller
  }
  if (!/^https?:$/i.test(u.protocol)) return null;
  const TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'src', 'trk'];
  TRACKING.forEach((p) => u.searchParams.delete(p));
  u.hash = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  let s = u.toString();
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** Pure non-date phrases (whole value), e.g. 'Rolling', 'TBD'. */
const NON_DATE_EXACT = /^(rolling|asap|ongoing|tbd|n\/?a|none|open)$/i;
const NON_DATE_PHRASE = /(open )?until filled|rolling basis|no deadline/i;

/**
 * Parse a deadline cell. Returns a strictly valid ISO date or null (original
 * text is preserved separately as deadline_text). Handles MM/DD/YY(YY),
 * YYYY-MM-DD, 'March 15, 2026', and finds dates inside phrases like
 * 'open until 03/15/2026'. Pure text like 'Rolling'/'ASAP' → null.
 */
export function parseDeadline(value: string): string | null {
  const s = value.trim();
  if (!s) return null;
  if (NON_DATE_EXACT.test(s)) return null;

  // Search (not anchor) so dates inside phrases are still found.
  const mdy = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mdy) {
    const [, m, d, yRaw] = mdy;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return toIsoDate(Number(y), Number(m), Number(d));
  }
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  if (NON_DATE_PHRASE.test(s)) return null;

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
    return toIsoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return null;
}

/** Strict calendar validation: rejects impossible dates like 2026-02-31. */
function toIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parsePaidStatus(value: string): PaidStatus {
  const s = value.trim().toLowerCase();
  if (!s) return 'unknown';
  if (/stipend|scholarship|award/.test(s)) return 'stipend';
  if (/unpaid|volunteer|no pay|credit only/.test(s)) return 'unpaid';
  if (/paid|\$|hour|salary|hr\b|wage/.test(s)) return 'paid';
  return 'unknown';
}

/** Trim + collapse whitespace; empty string becomes null. */
export function cleanText(value: string | undefined | null): string | null {
  const s = (value ?? '').replace(/\s+/g, ' ').trim();
  return s || null;
}

/**
 * Sanitize user-supplied search input before use in PostgREST ilike/or
 * filters: strips filter-syntax characters (, ( ) .) and LIKE wildcards.
 */
export function sanitizeSearchTerm(value: string | undefined | null): string | null {
  const s = (value ?? '').replace(/[,()%_\\.]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}
