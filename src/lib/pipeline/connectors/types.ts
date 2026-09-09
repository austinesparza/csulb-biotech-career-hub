/**
 * types.ts — the canonical shape every connector emits, and the HTML→text
 * conversion that everything downstream depends on.
 *
 * WHY THE CONVERTER MATTERS MORE THAN IT LOOKS: Greenhouse returns the posting
 * body as HTML-escaped markup. Evidence quotes are verified as literal
 * substrings of `rawText`. So if this function is not deterministic and stable,
 * a model quoting the posting it was shown will fail binding for no good reason,
 * and officers will lose trust in the flag. Treat changes here as breaking:
 * bump CONVERTER_VERSION and re-verify affected extractions.
 */

export const CONVERTER_VERSION = 1;

export interface CanonicalPosting {
  sourceKind: string;
  employer: string;
  /** Stable id within the source. Used with sourceKind for dedupe. */
  externalId: string;
  title: string;
  url: string;
  location: string;
  /** Plain text. Evidence quotes are checked against exactly this string. */
  rawText: string;
  postedAt: string | null;
  updatedAt: string | null;
  /** Anything the source gave us that we did not map. Kept for later use. */
  extra: Record<string, unknown>;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&nbsp;": " ", "&ndash;": "-", "&mdash;": "-", "&rsquo;": "'", "&lsquo;": "'",
  "&rdquo;": '"', "&ldquo;": '"', "&hellip;": "...", "&bull;": "-", "&reg;": "(R)",
  "&trade;": "(TM)", "&copy;": "(C)", "&deg;": " degrees", "&eacute;": "e",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity);
}

/**
 * HTML to plain text. Block elements become sentence breaks so that a bullet
 * list does not run its items together into a false sentence -- which would
 * otherwise let a model "quote" a span that no human would read as continuous.
 */
export function htmlToText(html: string): string {
  let text = decodeEntities(html);
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // Browser semantics: inside HTML, source newlines are insignificant -- a
  // paragraph split across source lines renders as one line. Block structure
  // comes from tags, not from where the author pressed Enter. Plain-text
  // sources (Lever descriptionPlain, page text) keep their newlines.
  const looksLikeHtml = /<\/?(p|div|li|br|ul|ol|h[1-6]|table|tr|td|span|strong|em|section|article)\b/i.test(text);
  if (looksLikeHtml) text = text.replace(/\s*\n\s*/g, " ");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<\/(p|div|tr|h[1-6]|section|article|ul|ol|table)>/gi, "\n");
  text = text.replace(/<\/li>/gi, "");           // the opening <li> already broke the line
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Same normalization used by lib/evidence.ts, so binding and display agree. */
export function toRawText(parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).map((p) => htmlToText(String(p))).join("\n\n").trim();
}

export interface ConnectorResult {
  postings: CanonicalPosting[];
  warnings: string[];
}

export interface Connector {
  kind: string;
  /** Build the request URL for a board identifier. Never called with user input directly. */
  listUrl(identifier: string): string;
  /** Parse a raw response body into canonical postings. Pure: no network. */
  parse(body: string, ctx: { employer: string; identifier: string }): ConnectorResult;
}
