/**
 * Pure normalization functions for the automated ingestion pipeline.
 *
 * All functions are deterministic and independently testable.
 * Raw values are always preserved separately — normalization never destroys data.
 *
 * Rules:
 * - Do not infer facts that are not present in the source.
 * - Ambiguous values must produce uncertainty flags, not guesses.
 * - Do not remove meaningful scientific terms, degree requirements,
 *   level markers, or geographic qualifiers.
 * - URL canonicalization removes fragments and known tracking parameters
 *   while preserving parameters required to reach the actual posting.
 */

import type { DeadlineKind, OpportunityClassification, RemoteType, UncertaintyFlag } from './types';

// ============================================================
// WHITESPACE AND UNICODE
// ============================================================

/**
 * Collapse all Unicode whitespace to a single ASCII space, trim edges.
 * Handles non-breaking spaces, zero-width spaces, tabs, and newlines.
 */
export function normalizeWhitespace(value: string): string {
  return value
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ') // non-breaking and zero-width
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Apply NFC Unicode normalization (canonical decomposition, canonical composition).
 * NFC is the standard form for text comparison and storage.
 */
export function normalizeUnicode(value: string): string {
  return value.normalize('NFC');
}

/**
 * Produce a canonical case-insensitive comparison value:
 * NFC → trim → collapse whitespace → lowercase.
 */
export function toCaseInsensitiveKey(value: string): string {
  return normalizeWhitespace(normalizeUnicode(value)).toLowerCase();
}

// ============================================================
// HTML ENTITY DECODING AND STRIPPING
// ============================================================

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&mdash;': '—',
  '&ndash;': '–',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&hellip;': '…',
  '&bull;': '•',
};

/**
 * Decode named and numeric HTML entities.
 * Handles &amp;, &lt;, &gt;, &quot;, &#NNN;, and &#xNNN; forms.
 */
export function decodeHtmlEntities(value: string): string {
  // Replace named entities
  let result = value.replace(
    /&[a-zA-Z][a-zA-Z0-9]{0,10};/g,
    (match) => HTML_ENTITIES[match] ?? match,
  );
  // Replace decimal numeric entities
  result = result.replace(/&#(\d{1,6});/g, (_, code: string) => {
    const n = parseInt(code, 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : _;
  });
  // Replace hexadecimal numeric entities
  result = result.replace(/&#x([0-9a-fA-F]{1,6});/g, (_, hex: string) => {
    const n = parseInt(hex, 16);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : _;
  });
  return result;
}

/**
 * Convert an HTML string to plain text:
 * 1. Remove script and style tag content entirely (including content between tags).
 * 2. Replace block-level tags with spaces.
 * 3. Strip all remaining tags.
 * 4. Decode entities.
 * 5. Collapse whitespace.
 *
 * Returns null for null/empty input.
 * Does not execute scripts or perform network requests.
 */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  let text = html
    // Remove script and style content entirely (including content between tags)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Replace block tags with spaces for readability
    .replace(/<\/?(p|br|div|li|tr|h[1-6]|blockquote|pre|ul|ol|table|thead|tbody|section|article)[^>]*>/gi, ' ')
    // Strip all remaining tags
    .replace(/<[^>]*>/g, ' ');
  text = decodeHtmlEntities(text);
  text = normalizeWhitespace(text);
  return text || null;
}

// ============================================================
// EMPLOYER NAME
// ============================================================

const COMPANY_SUFFIXES =
  /\s*\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|ag|nv|bv|srl)\b\.?$/i;

/**
 * Normalize an employer name:
 * NFC → trim → collapse whitespace → lowercase → strip legal suffixes.
 *
 * Preserves acronyms, scientific names, and institution names.
 * Returns null when the input is empty after normalization.
 */
export function normalizeEmployerName(name: string | null | undefined): string | null {
  if (!name) return null;
  const decoded = decodeHtmlEntities(normalizeUnicode(name));
  let s = normalizeWhitespace(decoded).toLowerCase();
  s = s.replace(COMPANY_SUFFIXES, '').trim();
  return s || null;
}

// ============================================================
// TITLE
// ============================================================

/**
 * Normalize a job title for comparison and storage.
 * Preserves season/year, scientific terms, degree level markers, roman numerals,
 * and accented/non-Latin letters (Unicode word characters are preserved).
 * Applies: NFC → entity decode → HTML strip → whitespace collapse → lowercase →
 *          dash normalization → punctuation strip (except slashes).
 *
 * Uses Unicode-aware character class [\p{L}\p{N}] to preserve accented and
 * non-Latin letters rather than the ASCII-only \w.
 */
export function normalizeJobTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const decoded = decodeHtmlEntities(htmlToText(title) ?? title);
  let s = normalizeWhitespace(decoded)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    // Keep Unicode letters, digits, whitespace, hyphens, and slashes; replace other chars with space
    .replace(/[^\p{L}\p{N}\s\-\/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

/**
 * Title family form: strip season, year, and cycle markers.
 * Used ONLY for annual-family deduplication flagging, never for identity.
 */
export function normalizeJobTitleFamily(title: string | null | undefined): string | null {
  const norm = normalizeJobTitle(title);
  if (!norm) return null;
  return norm
    .replace(/\b(20\d{2}|19\d{2}|spring|summer|fall|autumn|winter)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

// ============================================================
// LOCATION
// ============================================================

/**
 * Normalize a location string for comparison.
 * Preserves city, state, country, compound geographic names, and accented/non-Latin letters.
 * Uses Unicode-aware character class to avoid stripping non-ASCII letters.
 * Returns null for empty/null input.
 */
export function normalizeLocation(location: string | null | undefined): string | null {
  if (!location) return null;
  const decoded = decodeHtmlEntities(normalizeUnicode(location));
  const s = normalizeWhitespace(decoded)
    .toLowerCase()
    // Keep Unicode letters, digits, whitespace, commas, periods, hyphens
    .replace(/[^\p{L}\p{N}\s,.\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

// ============================================================
// DEPARTMENT
// ============================================================

/**
 * Normalize a department name for comparison.
 * Preserves scientific discipline names (e.g. "R&D", "Biochemistry").
 */
export function normalizeDepartment(dept: string | null | undefined): string | null {
  if (!dept) return null;
  const decoded = decodeHtmlEntities(normalizeUnicode(dept));
  const s = normalizeWhitespace(decoded).toLowerCase().trim();
  return s || null;
}

// ============================================================
// URL CANONICALIZATION
// ============================================================

/**
 * Known tracking parameters to strip from URLs.
 * Parameters required to reach the actual posting must be preserved.
 * Stored in lowercase; comparison is case-insensitive.
 */
const TRACKING_PARAMS_LOWER = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'ref',
  'src',
  'trk',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'hsctatracking',
]);

/**
 * Canonicalize a URL:
 * - Require http or https scheme; reject javascript:, data:, and other non-HTTP schemes.
 * - Lowercase protocol and hostname.
 * - Remove URL fragments.
 * - Remove known tracking parameters (case-insensitively).
 * - Preserve all other parameters (they may be required to reach the posting).
 * - Remove trailing slash from path (not from domain root).
 * Returns null for unparseable, non-HTTP(S), or empty input.
 */
export function canonicalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = normalizeWhitespace(url);
  if (!raw) return null;
  const withScheme = raw.includes('://') ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(u.protocol)) return null;
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  // Remove tracking params case-insensitively
  const keysToDelete: string[] = [];
  for (const key of u.searchParams.keys()) {
    if (TRACKING_PARAMS_LOWER.has(key.toLowerCase())) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    u.searchParams.delete(key);
  }
  let result = u.toString();
  // Remove trailing slash only when path is non-root (avoid stripping "https://example.com")
  if (u.pathname.length > 1 && result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
}

// ============================================================
// REMOTE TYPE CLASSIFICATION
// ============================================================

const REMOTE_SIGNALS = /\bremote\b/i;
/**
 * Hybrid requires explicit "hybrid" language.
 * Do not classify as hybrid based on remote+onsite signals alone.
 */
const HYBRID_SIGNALS = /\bhybrid\b/i;
const ONSITE_SIGNALS = /\b(on-?site|in-?office|in person|on ?campus|in-?person)\b/i;
const NEGATED_REMOTE_SIGNALS =
  /\b(not remote|no remote option|remote work is not available|remote is not available)\b/i;
const NEGATED_HYBRID_SIGNALS =
  /\b(not hybrid|no hybrid option|hybrid work is not available|this is not a hybrid role)\b/i;

/**
 * Classify the remote/hybrid/onsite status from title, location, and description text.
 *
 * Rules:
 * - 'hybrid' only when explicit "hybrid" language is present.
 * - Contradictory remote AND onsite signals (without "hybrid") → 'unknown' + remote_ambiguous.
 * - 'remote' only when remote signal present and no onsite signal.
 * - 'onsite' only when onsite signal present and no remote signal.
 * - 'unknown' when no signal, or contradictory without hybrid language.
 *
 * Does not infer from partial words (e.g. "remotely" or "in-remotely").
 */
export function classifyRemoteType(
  title: string | null,
  location: string | null,
  descriptionText: string | null,
): { remoteType: RemoteType; flags: UncertaintyFlag[] } {
  const combined = [title, location, descriptionText]
    .filter(Boolean)
    .join(' ');

  const hasRemote = REMOTE_SIGNALS.test(combined);
  const hasHybrid = HYBRID_SIGNALS.test(combined);
  const hasOnsite = ONSITE_SIGNALS.test(combined);
  const hasNegatedRemote = NEGATED_REMOTE_SIGNALS.test(combined);
  const hasNegatedHybrid = NEGATED_HYBRID_SIGNALS.test(combined);

  // Negation suppresses only the corresponding positive signal. For example,
  // "remote role; no hybrid option" remains remote, while "not remote; hybrid"
  // remains hybrid. A negated signal by itself is uncertain unless onsite is explicit.
  const effectiveRemote = hasRemote && !hasNegatedRemote;
  const effectiveHybrid = hasHybrid && !hasNegatedHybrid;

  if (effectiveHybrid) return { remoteType: 'hybrid', flags: [] };
  // Contradictory positive signals without explicit hybrid language → unknown.
  if (effectiveRemote && hasOnsite) return { remoteType: 'unknown', flags: ['remote_ambiguous'] };
  if (effectiveRemote) return { remoteType: 'remote', flags: [] };
  if (hasOnsite) return { remoteType: 'onsite', flags: [] };
  if (hasNegatedRemote || hasNegatedHybrid) {
    return { remoteType: 'unknown', flags: ['remote_ambiguous'] };
  }

  const flags: UncertaintyFlag[] = [];
  if (!location && !descriptionText) {
    flags.push('remote_ambiguous');
  }
  return { remoteType: 'unknown', flags };
}

// ============================================================
// EMPLOYMENT TYPE
// ============================================================

/** Normalize employment-type string. Returns null if absent. */
export function normalizeEmploymentType(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = toCaseInsensitiveKey(value);
  if (/full.?time/.test(s)) return 'full_time';
  if (/part.?time/.test(s)) return 'part_time';
  if (/\bco.?op\b/.test(s)) return 'co_op';
  if (/\bcontract\b/.test(s)) return 'contract';
  if (/\btemporary\b|\btemp\b/.test(s)) return 'temporary';
  if (/\bfellowship\b/.test(s)) return 'fellowship';
  if (/\binternship\b|\bintern\b/.test(s)) return 'internship';
  return value.trim() || null;
}

// ============================================================
// OPPORTUNITY CLASSIFICATION
// ============================================================

const INTERNSHIP_SIGNALS = /\bintern(ship)?\b/i;
/**
 * Fellowship signals: match "fellowship" but not bare "fellow" which appears in
 * "postdoctoral fellow", "research fellow", "senior fellow", etc. and should not
 * be classified as a student fellowship.
 */
const FELLOWSHIP_SIGNALS = /\bfellowship\b/i;
const RESEARCH_SIGNALS = /\bresearch\b|\bscientist\b|\banalyst\b/i;
/**
 * Entry-level signals: do NOT include bare "associate" (which appears in
 * "Associate Director", "Senior Associate", etc.) or bare "junior"/"senior"
 * (which appear in seniority titles). Use "entry-level" explicitly or "new grad".
 */
const ENTRY_SIGNALS = /\bentry.?level\b|\bnew grad\b|\bnew graduates?\b/i;

/**
 * Classify an opportunity from its title and employment-type string.
 * Returns classification and whether it was inferred (vs. explicit).
 */
export function classifyOpportunity(
  title: string | null,
  employmentType: string | null,
  descriptionText: string | null,
): { classification: OpportunityClassification; inferred: boolean } {
  const combined = [title, employmentType, descriptionText?.slice(0, 500)]
    .filter(Boolean)
    .join(' ');

  if (INTERNSHIP_SIGNALS.test(combined)) {
    return { classification: 'internship', inferred: !INTERNSHIP_SIGNALS.test(title ?? '') };
  }
  if (FELLOWSHIP_SIGNALS.test(combined)) {
    return { classification: 'fellowship', inferred: !FELLOWSHIP_SIGNALS.test(title ?? '') };
  }
  if (RESEARCH_SIGNALS.test(combined)) {
    return { classification: 'research', inferred: true };
  }
  if (ENTRY_SIGNALS.test(combined)) {
    return { classification: 'entry_level', inferred: true };
  }
  return { classification: 'other', inferred: true };
}

// ============================================================
// DATE PARSING
// ============================================================

/**
 * Parse a date string to ISO YYYY-MM-DD using only explicit deterministic formats.
 * Supported formats:
 * - ISO 8601 date: YYYY-MM-DD
 * - ISO 8601 datetime with T or space separator: YYYY-MM-DDTHH:MM:SS... or YYYY-MM-DD HH:MM:SS...
 * - ISO 8601 datetime with timezone offset: YYYY-MM-DDTHH:MM:SS±HH:MM
 * - MM/DD/YYYY or M/D/YYYY
 * - YYYY/MM/DD
 *
 * Unsupported formats (month names, locale-dependent strings) return null.
 * This avoids implementation-dependent behavior in Date.parse() for non-ISO strings.
 *
 * Returns null for invalid, empty, unsupported, or non-date input.
 * Uses UTC arithmetic to avoid timezone-dependent day shifts.
 */
export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = normalizeWhitespace(value);
  if (!s) return null;

  // Strict ISO 8601 date: YYYY-MM-DD
  const isoDateMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateMatch) {
    return toIsoDateSafe(
      Number(isoDateMatch[1]),
      Number(isoDateMatch[2]),
      Number(isoDateMatch[3]),
    );
  }

  // Strict ISO 8601 datetime:
  // YYYY-MM-DDTHH:MM:SS(.sss)?(Z|±HH:MM)?
  // YYYY-MM-DD HH:MM:SS(.sss)?(Z|±HH:MM)?
  const isoDateTimeMatch = s.match(
    /^(\d{4})-(\d{2})-(\d{2})([T ])(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(?:([+-])(\d{2}):(\d{2})|Z)?$/,
  );
  if (isoDateTimeMatch) {
    const y = Number(isoDateTimeMatch[1]);
    const mo = Number(isoDateTimeMatch[2]);
    const d = Number(isoDateTimeMatch[3]);
    const hh = Number(isoDateTimeMatch[5]);
    const mm = Number(isoDateTimeMatch[6]);
    const ss = Number(isoDateTimeMatch[7]);
    const frac = isoDateTimeMatch[8] ?? '';
    const sign = isoDateTimeMatch[9];
    const tzH = isoDateTimeMatch[10];
    const tzM = isoDateTimeMatch[11];

    if (!toIsoDateSafe(y, mo, d)) return null;
    if (hh > 23 || mm > 59 || ss > 59) return null;
    if ((tzH && Number(tzH) > 23) || (tzM && Number(tzM) > 59)) return null;

    const tz =
      sign && tzH && tzM
        ? `${sign}${tzH}:${tzM}`
        : (s.endsWith('Z') ? 'Z' : 'Z');
    const normalizedInput = `${isoDateTimeMatch[1]}-${isoDateTimeMatch[2]}-${isoDateTimeMatch[3]}T${isoDateTimeMatch[5]}:${isoDateTimeMatch[6]}:${isoDateTimeMatch[7]}${frac}${tz}`;
    const parsed = new Date(normalizedInput);
    if (Number.isNaN(parsed.getTime())) return null;
    return toIsoDateSafe(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }

  // MM/DD/YYYY or M/D/YYYY
  const mdySlash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdySlash) {
    return toIsoDateSafe(Number(mdySlash[3]), Number(mdySlash[1]), Number(mdySlash[2]));
  }

  // YYYY/MM/DD
  const ymdSlash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    return toIsoDateSafe(Number(ymdSlash[1]), Number(ymdSlash[2]), Number(ymdSlash[3]));
  }

  // All other formats (month names, natural language, etc.) are unsupported.
  // Do not use Date.parse() for non-ISO strings — implementation-dependent.
  return null;
}

/** Strict calendar validation: rejects impossible dates like 2026-02-31. */
function toIsoDateSafe(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Determine DeadlineKind from raw deadline text and/or a parsed date.
 */
export function classifyDeadlineKind(
  rawText: string | null,
  parsedDate: string | null,
): DeadlineKind {
  if (parsedDate) return 'hard';
  if (!rawText) return 'unknown';
  if (/rolling|ongoing|until filled|no deadline|open until/i.test(rawText)) return 'rolling';
  return 'unknown';
}

// ============================================================
// FOCUS AREA INFERENCE
// ============================================================

const FOCUS_AREA_MAP: Array<[RegExp, string]> = [
  [/\b(bioinformatics|computational bio(logy)?|genomics|proteomics|transcriptomics)\b/i, 'bioinformatics'],
  [/\b(crispr|gene edit|genome edit|genetic engineer)\b/i, 'genetic engineering'],
  [/\b(drug discovery|medicinal chem|pharmaceutical|pharma)\b/i, 'pharmaceutical'],
  [/\b(cell (bio|culture|therapy)|stem cell|regenerative)\b/i, 'cell biology'],
  [/\b(immunolog|antibod|immuno)\b/i, 'immunology'],
  [/\b(molecular bio|molecular diagnostics|pcr|sequencing)\b/i, 'molecular biology'],
  [/\b(biochem|enzyme|protein)\b/i, 'biochemistry'],
  [/\b(micro(biol|bio)|bacterio|virology|pathogen)\b/i, 'microbiology'],
  [/\b(clinical research|clinical trial|clinical study)\b/i, 'clinical research'],
  [/\b(biomanufactur|bioprocess|upstream|downstream|fermentation)\b/i, 'biomanufacturing'],
  [/\b(biomedical engineer|bme)\b/i, 'biomedical engineering'],
  [/\b(data sci|machine learning|ml|ai|analytics)\b/i, 'data science'],
  [/\b(regulatory|cmc|gmp|gdp|quality assurance|qa|qc)\b/i, 'regulatory & quality'],
  [/\b(lab tech|laboratory technician)\b/i, 'laboratory operations'],
  [/\b(research (assoc|assist|intern|scientist))\b/i, 'research'],
  [/\b(neurosci|neurobio)\b/i, 'neuroscience'],
  [/\b(oncol|cancer)\b/i, 'oncology'],
  [/\b(public health|epidemi)\b/i, 'public health'],
];

/**
 * Infer a focus area tag from job title and description.
 * Returns the first matching tag, or null if no signal is present.
 */
export function inferFocusArea(
  title: string | null,
  descriptionText: string | null,
): string | null {
  const combined = [title, descriptionText?.slice(0, 1000)].filter(Boolean).join(' ');
  for (const [pattern, tag] of FOCUS_AREA_MAP) {
    if (pattern.test(combined)) return tag;
  }
  return null;
}
