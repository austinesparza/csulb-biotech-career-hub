/**
 * highlight.ts — turn raw_text plus evidence offsets into renderable segments.
 *
 * This is the part of the review UI that has to be right. An officer verifies a
 * claim by seeing the sentence it came from, in place, in the original posting.
 * If an offset is off by a few characters the highlight lands on the wrong
 * words and the officer's verification is worthless -- worse than no highlight,
 * because it looks authoritative.
 *
 * Three problems this solves:
 *   1. OFFSET SPACE. Offsets from lib/evidence.ts index into NORMALIZED text
 *      (whitespace collapsed). Display wants the original, which has line
 *      breaks. Mapping between them is the bug nobody catches by eye.
 *   2. OVERLAPS. Two fields can legitimately cite overlapping spans. Naive
 *      slicing double-renders the overlap or drops it.
 *   3. UNCITED VALUES. A field the officer typed has no offsets. It must be
 *      visibly distinguishable from one that carries evidence.
 */

export interface Span {
  field: string;
  start: number;
  end: number;
}

export interface Segment {
  text: string;
  /** Fields citing this segment. Empty means plain, uncited text. */
  fields: string[];
  /** True when more than one field cites this exact run of text. */
  shared: boolean;
}

/** Must match normalize() in lib/evidence.ts exactly, or every offset is wrong. */
export function normalizeForOffsets(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Index map from normalized positions back to original positions.
 * Built by replaying the same normalization while recording where each kept
 * character came from. Without this, highlights drift by exactly the number of
 * collapsed whitespace characters before them -- which grows down the document,
 * so the first highlight looks fine and the last one is badly wrong.
 */
export function buildOffsetMap(original: string): number[] {
  const map: number[] = [];
  let pendingWhitespace = false;
  let started = false;

  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    if (/\s/.test(ch) || ch === "\u00a0") {
      if (started) pendingWhitespace = true;
      continue;
    }
    if (pendingWhitespace) { map.push(i - 1); pendingWhitespace = false; } // the single space kept
    map.push(i);
    started = true;
  }
  return map;
}

export interface HighlightResult {
  segments: Segment[];
  /** Fields whose offsets could not be placed. Rendered as uncited, never silently dropped. */
  unplaced: string[];
}

/**
 * Split `original` into consecutive segments annotated with the fields citing
 * them. Segments tile the input exactly: concatenating them reproduces the
 * original string, which is asserted in tests.
 */
export function segment(original: string, spans: Span[]): HighlightResult {
  const map = buildOffsetMap(original);
  const unplaced: string[] = [];

  const placed = spans
    .map((s) => {
      if (s.start < 0 || s.end > map.length || s.start >= s.end) { unplaced.push(s.field); return null; }
      const start = map[s.start];
      // map[end] is the first char AFTER the span; when the span reaches the end
      // of the document there is no such entry, so fall back to the last one + 1.
      const end = s.end < map.length ? map[s.end] : map[map.length - 1] + 1;
      if (start === undefined || end === undefined || start >= end) { unplaced.push(s.field); return null; }
      return { field: s.field, start, end };
    })
    .filter((s): s is { field: string; start: number; end: number } => s !== null);

  if (placed.length === 0) return { segments: [{ text: original, fields: [], shared: false }], unplaced };

  // Sweep over boundaries so overlapping spans produce shared segments rather
  // than duplicated or lost text.
  const boundaries = new Set<number>([0, original.length]);
  for (const s of placed) { boundaries.add(s.start); boundaries.add(s.end); }
  const points = [...boundaries].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i], to = points[i + 1];
    if (from >= to) continue;
    const fields = placed.filter((s) => s.start <= from && s.end >= to).map((s) => s.field);
    segments.push({ text: original.slice(from, to), fields, shared: fields.length > 1 });
  }
  return { segments, unplaced };
}

/** Stable colour index per field so a field keeps its colour across re-renders. */
export function fieldPalette(fields: string[]): Record<string, number> {
  return Object.fromEntries([...fields].sort().map((f, i) => [f, i % 6]));
}

export interface ReviewField {
  name: string;
  label: string;
  value: string;
  quote: string | null;
  bound: boolean;
  /** Set when the officer edited the value; drives the "no longer cited" warning. */
  edited?: boolean;
}

export interface ReviewSummary {
  total: number;
  cited: number;
  uncited: number;
  unknown: number;
  edited: number;
  /** Fields that assert a value with no supporting evidence. What to read first. */
  needsAttention: string[];
}

export function summarize(fields: ReviewField[]): ReviewSummary {
  const asserted = fields.filter((f) => f.value.trim() && f.value.trim() !== "Unknown");
  const uncited = asserted.filter((f) => !f.bound);
  return {
    total: fields.length,
    cited: asserted.filter((f) => f.bound).length,
    uncited: uncited.length,
    unknown: fields.length - asserted.length,
    edited: fields.filter((f) => f.edited).length,
    // Ordered so the most consequential unverified claims surface first.
    needsAttention: uncited
      .map((f) => f.name)
      .sort((a, b) => {
        const priority = ["masters_eligibility", "work_authorization", "deadline", "enrollment_rule", "return_rule", "gpa_requirement"];
        const ia = priority.indexOf(a), ib = priority.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }),
  };
}
