/**
 * posting-evidence.ts — what an employer page actually says.
 *
 * Classifies a fetched page (open-looking, closed, removed, blocked,
 * script-only, vendor error page, redirected away, conflicting requisition)
 * and extracts hard gates with the exact supporting sentence. Deterministic
 * and pure, so every value can be re-derived from the stored snapshot.
 *
 * Rules that matter more than the code:
 *   - HTTP 200 is never "open". An Apply control must be visible in the text
 *     we stored, the requisition must be consistent, and no closure or error
 *     language may be present. Even then the state is "apply_visible at time
 *     T", not a promise the employer still accepts applications.
 *   - Every gate is either backed by a quote that is a literal substring of
 *     the stored text, or it is explicitly "unknown" / "not_stated".
 *   - "not_stated" means the readable page did not mention it. It is not a
 *     claim that the restriction does not exist.
 */
import { htmlToText } from "./connectors/types";
import { looksUnusable } from "./fetch-chain";
import { extractDeadlineEvidence, normalizeJobTitle } from "../ingestion/normalize";
import { resolvePostingIdentity, type PostingIdentity } from "./posting-identity";

export type PageState =
  | "apply_visible"
  | "closed"
  | "removed"
  | "expired"
  | "blocked"
  | "script_only"
  | "error_page"
  | "redirected_away"
  | "requisition_conflict"
  | "fetch_error"
  | "ambiguous";

export interface Evidence<T extends string = string> {
  value: T;
  /** Literal substring of the stored text, or null when unknown/not stated. */
  quote: string | null;
}

export interface PostingGates {
  applyState: Evidence<"apply_visible" | "closed_stated" | "unknown">;
  deadline: Evidence & { date: string | null; kind: "hard" | "rolling" | "unknown" };
  term: Evidence & { season: string | null; year: number | null };
  degreeLevel: Evidence<
    "graduate_accepted" | "undergraduate_only" | "recent_graduate_only" | "phd_only" | "bachelor_or_higher" | "not_stated" | "unknown"
  >;
  yearInProgram: Evidence;
  continuedEnrollment: Evidence<"required" | "must_not_be_enrolled" | "not_stated" | "unknown">;
  institutionRestriction: Evidence<
    "named_institution_only" | "regional_affiliation" | "home_institution_excluded" | "not_stated" | "unknown"
  >;
  academicCredit: Evidence<"required" | "not_stated" | "unknown">;
  workAuthorization: Evidence<
    "permanent_no_sponsorship" | "citizenship_or_permanent_residence" | "independent_authorization" | "not_stated" | "unknown"
  >;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string | null;
  status: number;
  contentType?: string | null;
  body: string | null;
  redirects?: { url: string; status: number; location: string }[];
  retrievedAt: string;
}

export interface PageAssessment {
  state: PageState;
  reason: string;
  /** Plain text that quotes are bound against. Null when nothing readable. */
  text: string | null;
  pageTitle: string | null;
  finalIdentity: PostingIdentity | null;
  requisitionIdsOnPage: string[];
  gates: PostingGates;
}

const CLOSED_PATTERNS: [RegExp, string][] = [
  [/no longer (?:accepting|taking) applications/i, "no longer accepting applications"],
  [/(?:this|the) (?:job|position|role|posting|requisition|opportunity) (?:is|has been) (?:no longer available|closed|filled|removed|expired)/i, "role stated closed"],
  [/(?:job|position|role|posting) (?:has been )?filled/i, "role stated filled"],
  [/no longer (?:available|open|active)/i, "role no longer available"],
  [/(?:job|posting|requisition) is (?:inactive|closed)/i, "role inactive"],
  [/applications? (?:for this (?:job|role|position) )?(?:are|is) (?:now )?closed/i, "applications closed"],
  [/this job has expired/i, "job expired"],
];

const ERROR_PATTERNS: [RegExp, string][] = [
  [/the page you are looking for (?:doesn'?t|does not|no longer) exist/i, "vendor page-not-found"],
  [/\b(?:page|job) not found\b/i, "page not found"],
  [/\berror\s*(?:404|500|503)\b/i, "error status in page body"],
  [/something went wrong/i, "vendor error page"],
  [/we(?:'re| are) sorry[^.]{0,40}(?:error|unavailable|cannot be found)/i, "vendor error page"],
  [/(?:service|site) (?:is )?(?:temporarily )?unavailable/i, "service unavailable page"],
  [/invalid (?:job|requisition|posting) (?:id|link)/i, "invalid requisition link"],
];

const APPLY_TEXT = /\b(?:apply now|apply for (?:this|the) (?:job|position|role)|apply to (?:this|the) (?:job|position)|apply online|submit (?:an |your )?application|start (?:your )?application)\b/i;
const APPLY_MARKUP = /<(?:a|button)\b[^>]*(?:href="[^"]*apply[^"]*"|data-[a-z-]*apply|id="[^"]*apply[^"]*"|class="[^"]*apply[^"]*")/i;

const REQUISITION_LABEL = /(?:job\s+requisition\s+id|requisition\s+(?:id|number|#)|req(?:uisition)?\.?\s*(?:id|#|no\.?)|job\s+id|posting\s+id|job\s+number)\s*[:#]?\s*([A-Z]{0,4}[-_]?\d[\d-]{3,}[A-Z0-9-]*)/gi;

function sentenceAround(text: string, index: number, length: number): string {
  const before = text.lastIndexOf("\n", index);
  const dot = text.lastIndexOf(". ", index);
  const start = Math.max(before, dot >= 0 ? dot + 1 : -1, 0);
  const nextNewline = text.indexOf("\n", index + length);
  const nextDot = text.indexOf(". ", index + length);
  const candidates = [nextNewline, nextDot >= 0 ? nextDot + 1 : -1].filter((value) => value >= 0);
  const end = candidates.length ? Math.min(...candidates) : Math.min(text.length, index + length + 200);
  return text.slice(start, end).trim().slice(0, 400);
}

function firstMatch(text: string, patterns: RegExp[]): { quote: string; match: RegExpMatchArray } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined) {
      const quote = sentenceAround(text, match.index, match[0].length);
      // Binding guarantee: the quote is always a literal substring of text.
      if (text.includes(quote)) return { quote, match };
    }
  }
  return null;
}

function stateEvidence<T extends string>(value: T, quote: string | null = null): Evidence<T> {
  return { value, quote };
}

export function unknownGates(): PostingGates {
  return {
    applyState: stateEvidence("unknown"),
    deadline: { value: "unknown", quote: null, date: null, kind: "unknown" },
    term: { value: "unknown", quote: null, season: null, year: null },
    degreeLevel: stateEvidence("unknown"),
    yearInProgram: stateEvidence("unknown"),
    continuedEnrollment: stateEvidence("unknown"),
    institutionRestriction: stateEvidence("unknown"),
    academicCredit: stateEvidence("unknown"),
    workAuthorization: stateEvidence("unknown"),
  };
}

/** Plain text used for evidence binding; identical conversion to connectors. */
export function pageText(body: string, contentType?: string | null): string {
  if (contentType && /json/i.test(contentType)) return body.trim();
  return htmlToText(body);
}

function pageTitleFrom(body: string, text: string): string | null {
  const og = body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const raw = h1 ?? og ?? title ?? text.split("\n").find((line) => line.trim().length > 3) ?? null;
  return raw ? htmlToText(raw).replace(/\s+/g, " ").trim().slice(0, 300) || null : null;
}

export function requisitionIdsInText(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(REQUISITION_LABEL)) ids.add(match[1].toUpperCase().replace(/[-_.]+$/, ""));
  return [...ids];
}

function normalizeReq(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True when two requisition strings name the same requisition. */
export function sameRequisition(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = normalizeReq(a);
  const right = normalizeReq(b);
  // A one-digit difference can identify a different requisition. URL-specific
  // repost suffixes are removed by the identity parser before reaching here.
  return left.length > 0 && left === right;
}

export function extractGates(text: string, state: PageState, retrievedAt: string): PostingGates {
  const gates = unknownGates();
  gates.applyState = state === "apply_visible"
    ? stateEvidence("apply_visible", firstMatch(text, [APPLY_TEXT])?.quote ?? null)
    : state === "closed" || state === "expired" || state === "removed"
      ? stateEvidence("closed_stated", firstMatch(text, CLOSED_PATTERNS.map(([p]) => p))?.quote ?? null)
      : stateEvidence("unknown");

  const deadline = extractDeadlineEvidence(text);
  gates.deadline = deadline.evidenceText && text.includes(deadline.evidenceText)
    ? { value: deadline.date ?? deadline.kind, quote: deadline.evidenceText, date: deadline.date, kind: deadline.kind }
    : { value: "not_stated", quote: null, date: null, kind: "unknown" };

  const term = firstMatch(text, [
    /\b(spring|summer|fall|autumn|winter)\s+(?:of\s+)?(20\d{2})\b/i,
    /\b(20\d{2})\s+(spring|summer|fall|autumn|winter)\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\s+start\b/i,
  ]);
  if (term) {
    const [, a, b] = term.match;
    const seasonFirst = /^[a-z]/i.test(a);
    const season = (seasonFirst ? a : b).toLowerCase();
    gates.term = { value: `${season} ${seasonFirst ? b : a}`, quote: term.quote, season, year: Number(seasonFirst ? b : a) };
  } else {
    gates.term = { value: "not_stated", quote: null, season: null, year: null };
  }

  const undergradOnly = firstMatch(text, [
    /currently enrolled (?:full[- ]time )?(?:in an? |as an? )?(?:undergraduate|bachelor'?s)(?: degree)?(?: program| student)?/i,
    /rising (?:sophomores?|juniors?|seniors?)/i,
    /(?:must|should) be (?:an? )?(?:current )?undergraduate/i,
    /undergraduate students? (?:only|with at least)/i,
    /(?:second|third|2nd|3rd)(?: or (?:third|fourth|3rd|4th))? year (?:of|in) (?:a|an|their) (?:four|4)[- ]year/i,
    /pursuing (?:a|an) (?:bachelor'?s|undergraduate) degree/i,
  ]);
  const graduate = firstMatch(text, [
    /\b(?:master'?s|M\.?S\.?c?|MS) (?:or|and|\/) (?:Ph\.?D|doctoral)/i,
    /\b(?:undergraduate|bachelor'?s) (?:or|and|\/) (?:graduate|master'?s)\b/i,
    /\bgraduate students?\b/i,
    /\benrolled in (?:a|an) (?:[a-z-]+ ){0,3}(?:graduate|master'?s)(?: degree)? program/i,
    /\b(?:pursuing|enrolled in|candidate for) (?:a|an) (?:master'?s|MS|M\.S\.)/i,
    /\b(?:master'?s|MS|M\.S\.) (?:students?|candidates?)\b/i,
    /\bbachelor'?s(?: degree)? or higher\b/i,
  ]);
  const recentGraduate = firstMatch(text, [
    /(?:received|earned|completed|obtained) (?:a|their|your)? ?(?:bachelor'?s|master'?s|degree)[^.\n]{0,80}within (?:the )?(?:past |last )?(?:one|1|twelve|12) (?:year|months)/i,
    /recent (?:bachelor'?s|master'?s|college) graduates?/i,
  ]);
  const notEnrolled = firstMatch(text, [/not (?:be )?currently enrolled in a degree/i, /must not be (?:currently )?enrolled/i, /not currently enrolled/i]);
  const phdOnly = firstMatch(text, [/\b(?:Ph\.?D|doctoral) (?:students?|candidates?) only\b/i, /currently enrolled in a (?:Ph\.?D|doctoral) program/i]);

  if (recentGraduate && (notEnrolled || !graduate)) {
    gates.degreeLevel = stateEvidence("recent_graduate_only", recentGraduate.quote);
  } else if (phdOnly && !graduate?.quote.match(/master/i)) {
    gates.degreeLevel = stateEvidence("phd_only", phdOnly.quote);
  } else if (graduate && /bachelor'?s(?: degree)? or higher/i.test(graduate.match[0])) {
    gates.degreeLevel = stateEvidence("bachelor_or_higher", graduate.quote);
  } else if (graduate) {
    gates.degreeLevel = stateEvidence("graduate_accepted", graduate.quote);
  } else if (undergradOnly) {
    gates.degreeLevel = stateEvidence("undergraduate_only", undergradOnly.quote);
  } else {
    gates.degreeLevel = stateEvidence("not_stated");
  }

  const year = firstMatch(text, [
    /(?:at least )?(?:one|two|three|1|2|3) (?:full )?(?:years?|semesters?) (?:remaining|left)[^.\n]{0,40}/i,
    /rising (?:sophomore|junior|senior)s?/i,
    /(?:second|third|2nd|3rd)(?: or (?:third|fourth|3rd|4th))? year[^.\n]{0,40}/i,
    /(?:at least|minimum of) \d+ graduate credits?[^.\n]{0,60}/i,
    /graduat(?:e|ing|ion) (?:date )?(?:by|no earlier than|after) (?:spring|summer|fall|winter|december|may) ?(?:of )?20\d{2}/i,
  ]);
  gates.yearInProgram = year ? stateEvidence(year.match[0].trim(), year.quote) : stateEvidence("not_stated");

  const continued = firstMatch(text, [
    /return(?:ing)? to (?:school|your (?:academic )?program|campus)/i,
    /continu(?:ed|ous) (?:full[- ]time )?enrollment/i,
    /enrolled[^.\n]{0,60}(?:following|subsequent) (?:fall|semester|term)/i,
    /enrolled[^.\n]{0,40}(?:throughout|during) the (?:entire )?(?:internship|co-?op)/i,
    /continue (?:your|their) (?:studies|education|enrollment)/i,
  ]);
  gates.continuedEnrollment = notEnrolled
    ? stateEvidence("must_not_be_enrolled", notEnrolled.quote)
    : continued ? stateEvidence("required", continued.quote) : stateEvidence("not_stated");

  const namedInstitution = firstMatch(text, [
    /(?:limited|restricted|open|available) (?:only )?to (?:current(?:ly enrolled)? )?(?:students|applicants|candidates) (?:of|at|from|enrolled at|in) (?:the )?[A-Z][A-Za-z.&' -]{2,60}(?:University|College|Institute)/,
    /(?:must|should) be (?:a )?current(?:ly enrolled)? (?:student )?at (?:the )?[A-Z][A-Za-z.&' -]{2,60}(?:University|College)/,
    /[A-Z][A-Za-z.&' -]{2,40} University (?:co-?op )?students only/,
    /\b[A-Z]{2,6} ?\d{3}[A-Z]?\b course (?:enrollment|credit)/,
    /only (?:current )?[A-Z][A-Za-z]+ (?:University )?students (?:are eligible|may apply)/,
  ]);
  const regional = firstMatch(text, [
    /(?:enrolled at|attending|graduate of|at|from) (?:an? )?Indiana (?:college|university|institution)[^.\n]{0,80}/i,
    /(?:graduated from|attended) (?:an? )?Indiana high school/i,
    /(?:must )?(?:reside|live|residence) in (?:the )?(?:greater )?[A-Z][A-Za-z ]{2,30}(?: area| region)?/,
    /(?:connection|tie|ties) to (?:the state of )?[A-Z][a-z]+/,
  ]);
  const homeInstitution = firstMatch(text, [/home institution/i]);
  gates.institutionRestriction = namedInstitution
    ? stateEvidence("named_institution_only", namedInstitution.quote)
    : regional ? stateEvidence("regional_affiliation", regional.quote)
      : homeInstitution ? stateEvidence("home_institution_excluded", homeInstitution.quote)
        : stateEvidence("not_stated");

  const credit = firstMatch(text, [/(?:academic|college|course) credit/i]);
  gates.academicCredit = credit ? stateEvidence("required", credit.quote) : stateEvidence("not_stated");

  const permanent = firstMatch(text, [
    /(?:now or in the future|present or future|current or future)[^.\n]{0,60}sponsorship/i,
    /without (?:the )?(?:need for )?(?:current or future |present or future )?(?:visa |employment )?sponsorship/i,
    /permanent(?:ly)? (?:authorized|(?:U\.?S\.? )?work authorization)/i,
    /(?:will not|does not|cannot) (?:provide|offer) (?:visa |immigration )?sponsorship/i,
  ]);
  const citizen = firstMatch(text, [/U\.?S\.? citizen(?:ship)?/i, /lawful permanent resident/i]);
  const independent = firstMatch(text, [/independent (?:U\.?S\.? )?(?:work )?authorization/i, /authorized to work in the (?:U\.?S\.?|United States)/i]);
  gates.workAuthorization = permanent ? stateEvidence("permanent_no_sponsorship", permanent.quote)
    : citizen ? stateEvidence("citizenship_or_permanent_residence", citizen.quote)
      : independent ? stateEvidence("independent_authorization", independent.quote)
        : stateEvidence("not_stated");

  if (gates.deadline.date && gates.deadline.date < retrievedAt.slice(0, 10) && gates.applyState.value === "apply_visible") {
    // A past explicit deadline beats an Apply button left on a stale page.
    gates.applyState = stateEvidence("unknown");
  }
  return gates;
}

/**
 * Classify one fetched employer page against the identity the lead claimed.
 * A 200 response is only the starting point.
 */
export function assessFetchedPage(input: { page: FetchedPage; expected: PostingIdentity }): PageAssessment {
  const { page, expected } = input;
  const base = { text: null, pageTitle: null, finalIdentity: null, requisitionIdsOnPage: [] as string[], gates: unknownGates() };
  if (!page.status) return { ...base, state: "fetch_error", reason: "No HTTP response" };
  if (page.status === 404 || page.status === 410) {
    return { ...base, state: "removed", reason: `HTTP ${page.status}: the individual posting is gone from the employer site` };
  }
  if ([401, 403, 407, 429, 451].includes(page.status)) {
    return { ...base, state: "blocked", reason: `HTTP ${page.status}: access controlled or rate limited; not retried or bypassed` };
  }
  if (page.status >= 400) return { ...base, state: "fetch_error", reason: `HTTP ${page.status}` };
  if (page.status !== 200 && page.status !== 203) return { ...base, state: "ambiguous", reason: `Unexpected HTTP ${page.status}` };
  const body = page.body ?? "";
  const text = pageText(body, page.contentType);
  const finalIdentity = page.finalUrl ? resolvePostingIdentity(page.finalUrl) : null;
  const pageTitle = pageTitleFrom(body, text);
  const requisitionIdsOnPage = requisitionIdsInText(text);
  const withText = { text, pageTitle, finalIdentity, requisitionIdsOnPage };

  // Redirected off the individual posting: stale index entry or dead link.
  if (expected.detailPage && finalIdentity && !finalIdentity.detailPage) {
    return { ...withText, gates: unknownGates(), state: "redirected_away",
      reason: `Redirected from the requisition to ${page.finalUrl}, which is not an individual posting` };
  }
  if (expected.requisitionId && finalIdentity?.requisitionId && finalIdentity.tenantKey === expected.tenantKey
      && !sameRequisition(finalIdentity.requisitionId, expected.requisitionId)) {
    return { ...withText, gates: unknownGates(), state: "requisition_conflict",
      reason: `Requested ${expected.requisitionId} but landed on ${finalIdentity.requisitionId}` };
  }
  if (finalIdentity && expected.host && finalIdentity.host !== expected.host && finalIdentity.tenant?.employer !== expected.tenant?.employer
      && !(finalIdentity.tenant === null && expected.tenant === null)) {
    return { ...withText, gates: unknownGates(), state: "redirected_away",
      reason: `Redirected to a different tenant (${finalIdentity.host})` };
  }

  const error = ERROR_PATTERNS.find(([pattern]) => pattern.test(text));
  const closed = CLOSED_PATTERNS.find(([pattern]) => pattern.test(text));
  if (closed) {
    return { ...withText, gates: extractGates(text, "closed", page.retrievedAt), state: "closed", reason: `Employer page: ${closed[1]}` };
  }
  if (error && text.length < 3000) {
    return { ...withText, gates: unknownGates(), state: "error_page", reason: `HTTP 200 carrying a ${error[1]}` };
  }
  const unusable = looksUnusable(body);
  if (unusable) {
    const blocked = /bot-check|access denied|login|rate limit/i.test(unusable);
    return { ...withText, text: text || null, gates: unknownGates(), state: blocked ? "blocked" : "script_only",
      reason: `HTTP 200 but ${unusable}; Apply and eligibility cannot be read` };
  }
  const conflicting = expected.requisitionId && expected.system !== "yello" && requisitionIdsOnPage.length > 0
    && !requisitionIdsOnPage.some((id) => sameRequisition(id, expected.requisitionId));
  if (conflicting) {
    return { ...withText, gates: extractGates(text, "requisition_conflict", page.retrievedAt), state: "requisition_conflict",
      reason: `URL names ${expected.requisitionId}; page states ${requisitionIdsOnPage.join(", ")}` };
  }
  const deadline = extractDeadlineEvidence(text);
  if (deadline.date && deadline.date < page.retrievedAt.slice(0, 10)) {
    return { ...withText, gates: extractGates(text, "expired", page.retrievedAt), state: "expired",
      reason: `Employer-stated deadline ${deadline.date} is before the retrieval date` };
  }
  const applyVisible = APPLY_TEXT.test(text) || APPLY_MARKUP.test(body);
  if (!applyVisible) {
    return { ...withText, gates: extractGates(text, "ambiguous", page.retrievedAt), state: "ambiguous",
      reason: "Readable page without a visible Apply control; open state is unknown" };
  }
  return { ...withText, gates: extractGates(text, "apply_visible", page.retrievedAt), state: "apply_visible",
    reason: "Apply control visible in the stored employer text at retrieval time" };
}

const TITLE_NOISE = new Set(["intern", "interns", "internship", "co", "op", "coop", "the", "a", "an", "and", "of", "for", "in", "at", "to", "program", "summer", "spring", "fall", "winter", "2026", "2027", "2028", "future", "talent", "xmlname", "opportunities", "opportunity", "start"]);

/** Abbreviations employers use in titles that leads often spell out. */
const TITLE_ABBREVIATIONS: Record<string, string[]> = {
  reg: ["regulatory"], tr: ["translational", "research"], mfg: ["manufacturing"], dev: ["development"],
  ops: ["operations"], rd: ["research", "development"], qa: ["quality", "assurance"], qc: ["quality", "control"],
  pk: ["pharmacokinetics"], cmc: ["cmc"], ra: ["regulatory", "affairs"],
};

function titleTokens(value: string | null | undefined): Set<string> {
  const raw = (normalizeJobTitle(value ?? "") ?? "")
    .replace(/r\s*&\s*d/g, "rd")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !TITLE_NOISE.has(token));
  return new Set(raw.flatMap((token) => TITLE_ABBREVIATIONS[token] ?? [token]));
}

export type TitleComparison = "exact" | "similar" | "different" | "unknown";

/**
 * Compare a lead title to the employer page title. Leads often append a
 * location or start month ("..., Edison", "January 2027 start"), so a page
 * title fully contained in the lead is "similar". Generic titles are
 * "unknown", never "exact".
 */
export function compareTitles(leadTitle: string | null, pageTitle: string | null): TitleComparison {
  const lead = titleTokens(leadTitle);
  const page = titleTokens(pageTitle);
  if (lead.size === 0 || page.size === 0) return "unknown";
  const overlap = [...lead].filter((token) => page.has(token)).length;
  const leadCover = overlap / lead.size;
  const pageCover = overlap / page.size;
  if (leadCover === 1 && pageCover === 1) return "exact";
  if (pageCover === 1 && page.size >= 2) return "similar";
  if (leadCover >= 0.75 && pageCover >= 0.5) return "similar";
  if (leadCover >= 0.5 && lead.size <= 2) return "similar";
  return "different";
}
