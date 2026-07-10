// Paste-to-prefill: heuristics that turn a pasted job-posting text into
// draft field values. Runs entirely client-side on text the officer pasted;
// nothing is fetched from anywhere. Pure functions, unit-testable.
// The parser never publishes anything: its output only prefills a form whose
// result lands in needs_review.

import { cleanText, normalizeUrl, parseDeadline, parsePaidStatus } from './normalize';
import type { PaidStatus } from './types';

export interface PrefillResult {
  title: string | null;
  company: string | null;
  posting_url: string | null;
  location: string | null;
  deadline_text: string | null;
  paid_guess: PaidStatus;
  eligibility: string | null;
  focus_area: string | null;
  start_date_text: string | null;
  application_type: string | null;
}

const LABELS: Array<[keyof PrefillResult, RegExp]> = [
  ['company', /^(?:company|employer|organization|org)\s*[:\-]\s*(.+)$/i],
  ['location', /^(?:location|city|site|where)\s*[:\-]\s*(.+)$/i],
  ['deadline_text', /^(?:application deadline|deadline|apply by|closes?|due date)\s*[:\-]?\s*(.+)$/i],
  ['eligibility', /^(?:eligibility|requirements|who can apply|qualifications|class standing)\s*[:\-]\s*(.+)$/i],
  ['focus_area', /^(?:field|focus area|department|team|category|area)\s*[:\-]\s*(.+)$/i],
  ['start_date_text', /^(?:duration|term|start date|dates|timeline|length)\s*[:\-]\s*(.+)$/i],
  ['application_type', /^(?:application type|how to apply|apply via|application method)\s*[:\-]\s*(.+)$/i],
];

/** Best-effort prefill from pasted posting text. Officers correct the rest. */
export function prefillFromText(text: string): PrefillResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const result: PrefillResult = {
    title: null, company: null, posting_url: null, location: null,
    deadline_text: null, paid_guess: parsePaidStatus(text), eligibility: null,
    focus_area: null, start_date_text: null, application_type: null,
  };

  // First URL anywhere in the text, canonicalized.
  const urlMatch = text.match(/https?:\/\/[^\s"'<>)]+/i);
  if (urlMatch) result.posting_url = normalizeUrl(urlMatch[0]);

  // Title: first reasonably short line that isn't a URL or a label.
  result.title =
    lines.find(
      (l) => l.length >= 8 && l.length <= 90 && !/^https?:\/\//i.test(l) && !l.includes(':'),
    ) ?? null;

  // "Role at Company" pattern in the title line.
  if (result.title) {
    const at = result.title.match(/^(.{4,60}?)\s+at\s+([A-Z][\w&.,' -]{2,50})$/);
    if (at) {
      result.title = cleanText(at[1]);
      result.company = cleanText(at[2]);
    }
  }

  // Labeled lines win over guesses.
  for (const line of lines) {
    for (const [field, re] of LABELS) {
      if (result[field]) continue;
      const m = line.match(re);
      if (m) (result[field] as string | null) = cleanText(m[1]);
    }
  }

  // Deadline fallback: any line with a deadline keyword that parses as a date.
  if (!result.deadline_text) {
    for (const line of lines) {
      if (/deadline|apply by|closes|due/i.test(line) && parseDeadline(line)) {
        result.deadline_text = cleanText(line);
        break;
      }
    }
  }

  // Duration/term fallback: "12 weeks", "3 months", "Summer 2027".
  if (!result.start_date_text) {
    const dur = text.match(/\b\d+\s*(?:week|month)s?\b/i) ?? text.match(/\b(?:spring|summer|fall|winter)\s+20\d{2}\b/i);
    if (dur) result.start_date_text = cleanText(dur[0]);
  }

  // Remote/hybrid hint folds into location.
  const remote = /\bremote\b/i.test(text);
  const hybrid = /\bhybrid\b/i.test(text);
  if (result.location && hybrid && !/hybrid/i.test(result.location)) {
    result.location = `${result.location} (hybrid)`;
  } else if (!result.location && (remote || hybrid)) {
    result.location = hybrid ? 'Hybrid' : 'Remote';
  }

  return result;
}
