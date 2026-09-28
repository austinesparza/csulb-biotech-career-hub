/**
 * verification-eval.ts — before/after replay on the fixed evaluation set.
 *
 * Offline and deterministic. It measures mechanisms, not live coverage:
 *   - query reachability: can any scheduled query's boolean constraints be
 *     satisfied by the role's indexable title/employer/URL? This is an UPPER
 *     bound on retrieval (ranking and top-k are not modelled) and an exact
 *     test of whether restrictive terms make a role unreachable;
 *   - candidate acceptance and requisition/employer attribution of the known
 *     official URL;
 *   - page verification on SYNTHETIC page reconstructions under two
 *     governance scenarios: every tenant governed (mechanism) and the
 *     documented production registry (three Greenhouse boards);
 *   - duplicate decisions on labelled URL pairs and known existing records;
 *   - modelled discovery-to-review latency from rotation cadence.
 * Failures are reported per row by the first stage that stopped the role.
 */
import evalSet from "./official-posting-eval-set.json";
import { buildCompleteEmployerInventoryPlans } from "../employer-inventory";
import { buildHistoricalWatchPlans } from "../historical-watch";
import { loadTaxonomy } from "../classify";
import { buildEmployerSearchPlan, buildLaneSearchPlans } from "../search-plan";
import { legacyEmployerSearchPlan, legacyLaneSearchPlans } from "./legacy-query-plans";
import { legacyExactRoleQueries, legacyPostingRequisitionId, legacyResearchCandidateScore } from "./legacy-research-candidate";
import { researchCandidateScore } from "../source-research-discovery";
import { attributeEmployer, resolvePostingIdentity, sameEmployerName } from "../posting-identity";
import { assessFetchedPage, type PageState } from "../posting-evidence";
import { decideDuplicate, decideVerification, type ExistingRecord, type VerificationOutcome } from "../posting-verification";
import { governVerification, type VerificationSourceRow } from "../verification-runner";
import { registryEmployers, rotationDays, tenantHostsFor } from "../query-families";
import { isRecognizedAtsHost } from "../ats-hosts";
import { sourceInstitutionRestriction } from "../../ingestion/source-eligibility";

export interface EvalCase {
  id: string;
  origin: string;
  employer: string;
  leadTitle: string;
  officialTitle: string | null;
  officialUrl: string | null;
  identifiable: boolean;
  expected: {
    requisitionId: string | null;
    closed: boolean;
    existingRecord: boolean;
    degree: string;
    institution: string;
    workAuthorization: string;
    continuedEnrollment: string;
    academicCredit: string;
    lookalikeOf: string | null;
    outOfCycle: boolean;
  };
  traits: { genericTitle: boolean; unexpectedTitle: boolean; offCycle: boolean; lanes: string[] };
  page: { kind: "readable" | "closed" | "script_shell" | "none"; title?: string; paragraphs?: string[] };
  note?: string;
}

const data = evalSet as unknown as {
  cases: EvalCase[];
  duplicatePairs: Array<{ a: string; b: string; same: boolean; why: string }>;
  existingRecords: Array<{ table: "opportunities"; id: string; url: string; status: string }>;
  attributionTraps: Array<{ leadEmployer: string; leadTitle: string; url: string; truth: "mismatch" | "needs_page"; why: string }>;
};

/** Misleading-tenant traps: a claim of employer ownership from the URL alone is an error. */
export function scoreAttributionTraps(): { traps: number; beforeWrongClaims: string[]; afterWrongClaims: string[] } {
  const beforeWrongClaims: string[] = [];
  const afterWrongClaims: string[] = [];
  for (const trap of data.attributionTraps) {
    const host = new URL(trap.url).hostname.toLowerCase();
    // Before: discovery labelled any recognized ATS host as employer-controlled for the hint.
    if (isRecognizedAtsHost(host)) beforeWrongClaims.push(trap.why);
    const status = attributeEmployer({ leadEmployer: trap.leadEmployer, identity: resolvePostingIdentity(trap.url) }).status;
    if (status === "match" || status === "page_named" || status === "operating_company_confirmed") afterWrongClaims.push(trap.why);
  }
  return { traps: data.attributionTraps.length, beforeWrongClaims, afterWrongClaims };
}
export const EVAL_CASES = data.cases;

/* ------------------------------------------------------------------------ */
/* Boolean query matcher (Google/Brave-style: OR binds neighbours, implicit AND). */
/* ------------------------------------------------------------------------ */

type Node = { kind: "and" | "or"; items: Node[] } | { kind: "term"; value: string; site: boolean; negate: boolean };

function tokenize(query: string): string[] {
  return query.match(/-?site:\S+|-?"[^"]*"|\(|\)|[^\s()"]+/g) ?? [];
}

function parse(tokens: string[]): Node {
  let index = 0;
  function unary(): Node | null {
    const token = tokens[index];
    if (token === undefined || token === ")") return null;
    index++;
    if (token === "(") {
      const inner = andExpr();
      if (tokens[index] === ")") index++;
      return inner;
    }
    const negate = token.startsWith("-") && token.length > 1;
    const raw = negate ? token.slice(1) : token;
    if (raw.startsWith("site:")) return { kind: "term", value: raw.slice(5).toLowerCase(), site: true, negate };
    return { kind: "term", value: raw.replace(/^"|"$/g, ""), site: false, negate };
  }
  function orExpr(): Node | null {
    const first = unary();
    if (!first) return null;
    const items = [first];
    while (tokens[index] === "OR") {
      index++;
      const next = unary();
      if (next) items.push(next);
    }
    return items.length === 1 ? first : { kind: "or", items };
  }
  function andExpr(): Node {
    const items: Node[] = [];
    while (index < tokens.length && tokens[index] !== ")") {
      if (tokens[index] === "AND") { index++; continue; }
      const next = orExpr();
      if (!next) break;
      items.push(next);
    }
    return { kind: "and", items };
  }
  return andExpr();
}

function words(value: string): string {
  return ` ${value.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export interface IndexDoc { url: string; text: string }

function evalNode(node: Node, doc: IndexDoc, host: string, path: string, text: string): boolean {
  if (node.kind === "and") return node.items.every((item) => evalNode(item, doc, host, path, text));
  if (node.kind === "or") return node.items.some((item) => evalNode(item, doc, host, path, text));
  if (node.kind !== "term") return false;
  let hit: boolean;
  if (node.site) {
    const [siteHost, ...rest] = node.value.split("/");
    const sitePath = rest.length ? `/${rest.join("/")}` : "";
    hit = (host === siteHost || host.endsWith(`.${siteHost}`)) && path.toLowerCase().startsWith(sitePath.toLowerCase());
  } else {
    const needle = words(node.value);
    hit = needle.trim().length > 0 && text.includes(needle);
  }
  return node.negate ? !hit : hit;
}

/** True when the query's boolean constraints can be satisfied by the document. */
export function queryMatches(query: string, doc: IndexDoc): boolean {
  let host = "";
  let path = "/";
  try {
    const url = new URL(doc.url);
    host = url.hostname.toLowerCase().replace(/^www\./, "");
    path = url.pathname;
  } catch { /* unparseable URL: site: terms cannot match */ }
  return evalNode(parse(tokenize(query)), doc, host, path, words(doc.text));
}

/** What an index can show for a role: the employer page and a LinkedIn job page. */
export function indexDocs(row: EvalCase): IndexDoc[] {
  const title = row.officialTitle ?? row.leadTitle;
  const docs: IndexDoc[] = [];
  if (row.officialUrl) docs.push({ url: row.officialUrl, text: `${title} ${row.employer}` });
  if (row.origin === "screenshot_2026-09-24" || row.origin === "pattern_synthetic") {
    const slug = row.leadTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    docs.push({ url: `https://www.linkedin.com/jobs/view/${slug}-at-x`, text: `${row.employer} hiring ${row.leadTitle}` });
  }
  return docs;
}

/* ------------------------------------------------------------------------ */
/* Scheduled query universe, before and after                                */
/* ------------------------------------------------------------------------ */

export interface ScheduledQuery { family: string; query: string; employer: string | null; cycleDays: number }

const CYCLE_YEAR = 2027;
const MONTH = 9;

function beforeSchedule(): ScheduledQuery[] {
  const taxonomy = loadTaxonomy();
  const inventory = buildCompleteEmployerInventoryPlans(CYCLE_YEAR);
  const watch = buildHistoricalWatchPlans({ cycleYear: CYCLE_YEAR, month: MONTH });
  const employers = new Map<string, { domain: string | null; programs?: string[] }>();
  for (const item of watch) employers.set(item.company, { domain: item.careersDomain, programs: item.programTerms });
  for (const item of inventory) if (!employers.has(item.company)) employers.set(item.company, { domain: item.plan.careersDomain });
  const employerCycle = rotationDays(employers.size, 5);
  const out: ScheduledQuery[] = [];
  for (const [employer, info] of employers) {
    for (const query of legacyEmployerSearchPlan({ employer, cycleYear: CYCLE_YEAR, careersDomain: info.domain, programTerms: info.programs }).queries) {
      out.push({ family: `employer:${query.route}`, query: query.query, employer, cycleDays: employerCycle });
    }
  }
  const lanes = legacyLaneSearchPlans(taxonomy, CYCLE_YEAR);
  for (const lane of lanes) for (const query of lane.queries) {
    out.push({ family: `lane:${query.route}`, query: query.query, employer: null, cycleDays: rotationDays(lanes.length, 1) });
  }
  return out;
}

export const AFTER_PRIORITY_PER_DAY = 5;
export const AFTER_INVENTORY_PER_DAY = 5;

function afterSchedule(): ScheduledQuery[] {
  const taxonomy = loadTaxonomy();
  const inventory = buildCompleteEmployerInventoryPlans(CYCLE_YEAR);
  const watch = buildHistoricalWatchPlans({ cycleYear: CYCLE_YEAR, month: MONTH });
  const priority = new Map<string, { domain: string | null; programs?: string[] }>();
  for (const item of watch) priority.set(item.company, { domain: item.careersDomain, programs: item.programTerms });
  for (const company of registryEmployers()) if (!priority.has(company)) priority.set(company, { domain: tenantHostsFor(company)[0] ?? null });
  const priorityCycle = rotationDays(priority.size, AFTER_PRIORITY_PER_DAY);
  const rest = inventory.filter((item) => ![...priority.keys()].some((name) => name.toLowerCase() === item.company.toLowerCase()));
  const inventoryCycle = rotationDays(rest.length, AFTER_INVENTORY_PER_DAY);
  const out: ScheduledQuery[] = [];
  for (const [employer, info] of priority) {
    for (const query of buildEmployerSearchPlan({ employer, cycleYear: CYCLE_YEAR, careersDomain: info.domain, programTerms: info.programs, graduateArm: true }).queries) {
      out.push({ family: `employer:${query.route}`, query: query.query, employer, cycleDays: priorityCycle });
    }
  }
  for (const item of rest) {
    for (const query of item.plan.queries) out.push({ family: `employer:${query.route}`, query: query.query, employer: item.company, cycleDays: inventoryCycle });
  }
  const lanes = buildLaneSearchPlans(taxonomy, CYCLE_YEAR);
  for (const lane of lanes) for (const query of lane.queries) {
    out.push({ family: `lane:${query.route}`, query: query.query, employer: null, cycleDays: rotationDays(lanes.length, 1) });
  }
  return out;
}

function employerScheduled(schedule: ScheduledQuery[], employer: string): boolean {
  return schedule.some((item) => item.employer && sameEmployerName(item.employer, employer));
}

function reachingQueries(schedule: ScheduledQuery[], row: EvalCase, employerAgnosticOnly = false): ScheduledQuery[] {
  const docs = indexDocs(row);
  return schedule.filter((item) => {
    if (employerAgnosticOnly && item.employer) return false;
    // An employer-scoped query only retrieves that employer's roles.
    if (item.employer && !sameEmployerName(item.employer, row.employer)
      && !tenantHostsFor(item.employer).some((host) => docs.some((doc) => doc.url.includes(host)))) return false;
    return docs.some((doc) => queryMatches(item.query, doc));
  });
}

/* ------------------------------------------------------------------------ */
/* Page fixtures and governance scenarios                                    */
/* ------------------------------------------------------------------------ */

export const RETRIEVED_AT = "2026-09-25T18:00:00.000Z";

export function fixtureHtml(row: EvalCase): { status: number; body: string } | null {
  if (row.page.kind === "none" || !row.officialUrl) return null;
  if (row.page.kind === "script_shell") {
    return { status: 200, body: '<html><head><title>Workday</title><script src="/wday/cxs/app.js"></script></head><body><div id="root"></div><noscript>Please enable JavaScript to view this page.</noscript></body></html>' };
  }
  const paragraphs = (row.page.paragraphs ?? []).map((text) => (text === "Apply now"
    ? '<a class="apply-button" href="/apply">Apply now</a>'
    : `<p>${text.replace(/&/g, "&amp;")}</p>`)).join("");
  const reqLine = row.expected.requisitionId ? `<p>Requisition ID: ${row.expected.requisitionId}</p>` : "";
  return {
    status: 200,
    body: `<!doctype html><html><head><title>${row.page.title} | Careers</title></head><body><main><h1>${row.page.title}</h1>${reqLine}${paragraphs}`
      + "<footer>We are an equal opportunity employer and value diversity at our company. Explore benefits, culture, locations and our hiring process on this careers site.</footer></main></body></html>",
  };
}

function governedSource(id: string, kind: string, identifier: string | null, hosts: string[]): VerificationSourceRow {
  return {
    id, source_name: id, source_kind: kind as VerificationSourceRow["source_kind"], source_identifier: identifier,
    careers_url: `https://${hosts[0] ?? "example.com"}/`, api_endpoint: null,
    config_json: hosts.length ? { requisition_verification: { enabled: true, hosts, path_prefixes: [] } } : {},
    enabled: true, terms_reviewed: true, terms_review_date: "2026-09-20", robots_reviewed: true,
    automatic_scheduling_paused_at: null, consecutive_failures: 0, fetch_tier: 0, tier_clean_runs: 0, last_successful_at: null,
  };
}

/** Documented production registry on 2026-09-24: three enabled Greenhouse boards. */
export const PRODUCTION_SOURCES: VerificationSourceRow[] = [
  governedSource("flagship", "greenhouse", "fspco-op012325", []),
  governedSource("ginkgo", "greenhouse", "ginkgobioworks", []),
  governedSource("xaira", "greenhouse", "xairatherapeutics", []),
].map((source) => source.source_identifier === "fspco-op012325" ? { ...source, enabled: false } : source);

/** Mechanism scenario: every eval tenant has a reviewed, scoped source. */
export function allTenantSources(): VerificationSourceRow[] {
  const hosts = [...new Set(EVAL_CASES.map((row) => row.officialUrl && resolvePostingIdentity(row.officialUrl).host).filter((host): host is string => !!host))];
  return hosts.map((host, index) => governedSource(`page-${index}`, "static_html", null, [host]));
}

/* ------------------------------------------------------------------------ */
/* Per-row replay                                                            */
/* ------------------------------------------------------------------------ */

export type FailureCause =
  | "not_identifiable"
  | "employer_not_scheduled"
  | "query_constraints_unsatisfiable"
  | "no_employer_requisition_known"
  | "candidate_url_rejected"
  | "requisition_misparsed"
  | "attribution_needs_page_evidence"
  | "attribution_mismatch"
  | "no_governed_source"
  | "script_only_page"
  | "closed_on_employer_page"
  | "gate_excluded"
  | "duplicate_existing"
  | "reached_review";

export interface RowResult {
  id: string;
  employer: string;
  title: string;
  discovered: boolean;
  discoveredEmployerAgnostic: boolean;
  reachingFamilies: string[];
  bestCycleDays: number | null;
  candidateAccepted: boolean;
  requisitionCorrect: boolean | null;
  attributionClaimed: boolean;
  attributionCorrect: boolean | null;
  pageState: PageState | "not_fetched" | null;
  outcome: VerificationOutcome | null;
  cause: FailureCause;
  falseOpen: boolean;
}

function expectedAttribution(row: EvalCase): "match" | "needs_page" | "mismatch" | null {
  if (!row.officialUrl) return null;
  const identity = resolvePostingIdentity(row.officialUrl);
  if (!identity.tenant) return "needs_page";
  const tenantNames = [identity.tenant.employer, ...identity.tenant.aliases];
  if (!identity.tenant.shared && tenantNames.some((name) => sameEmployerName(name, row.employer))) return "match";
  if (identity.tenant.shared || identity.tenant.operatingCompanies.some((name) => sameEmployerName(name, row.employer))) return "needs_page";
  return "mismatch";
}

function legacyKnownDomain(company: string): string | null {
  const watch = buildHistoricalWatchPlans({ cycleYear: CYCLE_YEAR, month: MONTH }).find((item) => item.company.toLowerCase() === company.toLowerCase());
  if (watch) return watch.careersDomain;
  const inventory = buildCompleteEmployerInventoryPlans(CYCLE_YEAR).slice(0, 50).find((item) => item.company.toLowerCase() === company.toLowerCase());
  return inventory?.plan.careersDomain ?? null;
}

function existingRecords(): ExistingRecord[] {
  return data.existingRecords.map((record) => ({ table: record.table, id: record.id, url: record.url, title: null, employer: null, status: record.status }));
}

export function replayRow(row: EvalCase, arm: "before" | "after", governance: "all_tenants" | "production", schedules: { before: ScheduledQuery[]; after: ScheduledQuery[] }): RowResult {
  const schedule = arm === "before" ? schedules.before : schedules.after;
  const title = row.officialTitle ?? row.leadTitle;
  const base: RowResult = {
    id: row.id, employer: row.employer, title: row.leadTitle, discovered: false, discoveredEmployerAgnostic: false, reachingFamilies: [],
    bestCycleDays: null, candidateAccepted: false, requisitionCorrect: null, attributionClaimed: false, attributionCorrect: null,
    pageState: null, outcome: null, cause: "not_identifiable", falseOpen: false,
  };
  if (!row.identifiable) return base;
  const reaching = reachingQueries(schedule, row);
  base.discovered = reaching.length > 0;
  base.discoveredEmployerAgnostic = reachingQueries(schedule, row, true).length > 0;
  base.reachingFamilies = [...new Set(reaching.map((item) => item.family))];
  base.bestCycleDays = reaching.length ? Math.min(...reaching.map((item) => item.cycleDays)) : null;
  if (!base.discovered) {
    base.cause = employerScheduled(schedule, row.employer) || schedule.some((item) => !item.employer) ? "query_constraints_unsatisfiable" : "employer_not_scheduled";
    if (!employerScheduled(schedule, row.employer)) base.cause = "employer_not_scheduled";
    return base;
  }
  if (!row.officialUrl) { base.cause = "no_employer_requisition_known"; return base; }

  // Candidate acceptance of the known employer URL, as the search result would present it.
  const result = { url: row.officialUrl, title: `${title} - ${row.employer}`, snippet: row.employer, rank: 1 };
  if (arm === "before") {
    base.candidateAccepted = legacyResearchCandidateScore({ result, company: row.employer, title: row.leadTitle, careersDomain: legacyKnownDomain(row.employer) }) > 0
      || isRecognizedAtsHost(new URL(row.officialUrl).hostname);
    const req = legacyPostingRequisitionId(row.officialUrl);
    base.requisitionCorrect = row.expected.requisitionId ? req === row.expected.requisitionId.toUpperCase() : null;
    // The earlier pipeline attributed any recognized ATS or careers-domain URL to the hinted employer.
    base.attributionClaimed = base.candidateAccepted;
  } else {
    const identity = resolvePostingIdentity(row.officialUrl);
    base.candidateAccepted = identity.detailPage && (researchCandidateScore({ result, company: row.employer, title: row.leadTitle, careersDomain: tenantHostsFor(row.employer)[0] ?? null }) > 0
      || identity.tenant !== null || isRecognizedAtsHost(identity.host ?? ""));
    base.requisitionCorrect = row.expected.requisitionId ? identity.requisitionId === row.expected.requisitionId.toUpperCase() : null;
    base.attributionClaimed = base.candidateAccepted && attributeEmployer({ leadEmployer: row.employer, identity }).status === "match";
  }
  const truth = expectedAttribution(row);
  base.attributionCorrect = base.attributionClaimed ? truth === "match" : null;
  if (!base.candidateAccepted) { base.cause = "candidate_url_rejected"; return base; }
  if (base.requisitionCorrect === false) base.cause = "requisition_misparsed";

  if (arm === "before") {
    // No verification stage existed: an indexed candidate stays unknown.
    base.pageState = "not_fetched";
    base.outcome = null;
    base.cause = base.requisitionCorrect === false ? "requisition_misparsed"
      : truth === "mismatch" ? "attribution_mismatch" : "no_governed_source";
    return base;
  }

  const identity = resolvePostingIdentity(row.officialUrl);
  const sources = governance === "production" ? PRODUCTION_SOURCES : [...allTenantSources(), ...PRODUCTION_SOURCES];
  const gov = governVerification(identity, sources);
  const html = fixtureHtml(row);
  const existing = existingRecords();
  const assessment = gov.mode === "page" && html
    ? assessFetchedPage({ page: { requestedUrl: row.officialUrl, finalUrl: row.officialUrl, status: html.status, body: html.body, contentType: "text/html", redirects: [], retrievedAt: RETRIEVED_AT }, expected: identity })
    : null;
  const decision = decideVerification({
    lead: { employer: row.employer, title: row.leadTitle, url: row.officialUrl },
    assessment, governanceReason: gov.mode === "blocked" ? gov.reason : null, existing, retrievedAt: RETRIEVED_AT,
  });
  const restriction = gov.mode !== "blocked" ? sourceInstitutionRestriction(gov.source) : null;
  if (restriction && decision.outcome === "review_candidate") decision.outcome = "gate_excluded";
  base.pageState = assessment?.state ?? "not_fetched";
  base.outcome = decision.outcome;
  base.falseOpen = base.pageState === "apply_visible" && (row.expected.closed || row.page.kind !== "readable");
  base.cause = ({
    review_candidate: "reached_review",
    duplicate_existing: "duplicate_existing",
    repeat_candidate: "duplicate_existing",
    closed: "closed_on_employer_page",
    gate_excluded: "gate_excluded",
    rejected_attribution: "attribution_mismatch",
    rejected_title_mismatch: "candidate_url_rejected",
    rejected_not_requisition: "candidate_url_rejected",
    unresolved_governance: "no_governed_source",
    unresolved_page: assessment?.state === "script_only" ? "script_only_page" : "no_governed_source",
    unresolved_attribution: "attribution_needs_page_evidence",
    unresolved_conflict: "requisition_misparsed",
  } as Record<VerificationOutcome, FailureCause>)[decision.outcome];
  return base;
}

/* ------------------------------------------------------------------------ */
/* Gate precision                                                            */
/* ------------------------------------------------------------------------ */

const GATE_KEYS = ["degree", "institution", "workAuthorization", "continuedEnrollment", "academicCredit"] as const;
const GATE_FIELD: Record<(typeof GATE_KEYS)[number], string> = {
  degree: "degreeLevel", institution: "institutionRestriction", workAuthorization: "workAuthorization",
  continuedEnrollment: "continuedEnrollment", academicCredit: "academicCredit",
};

export interface GateScore { gate: string; asserted: number; correct: number; expectedSpecified: number; recovered: number; errors: Array<{ id: string; expected: string; got: string }> }

export function scoreGates(): GateScore[] {
  const scores = GATE_KEYS.map((gate) => ({ gate, asserted: 0, correct: 0, expectedSpecified: 0, recovered: 0, errors: [] as GateScore["errors"] }));
  for (const row of EVAL_CASES) {
    const html = fixtureHtml(row);
    if (!html || row.page.kind !== "readable" || !row.officialUrl) continue;
    const assessment = assessFetchedPage({ page: { requestedUrl: row.officialUrl, finalUrl: row.officialUrl, status: 200, body: html.body, contentType: "text/html", redirects: [], retrievedAt: RETRIEVED_AT }, expected: resolvePostingIdentity(row.officialUrl) });
    GATE_KEYS.forEach((gate, index) => {
      const expected = row.expected[gate];
      const got = (assessment.gates as unknown as Record<string, { value: string }>)[GATE_FIELD[gate]].value;
      const score = scores[index];
      const asserted = got !== "not_stated" && got !== "unknown";
      const specified = expected !== "not_stated" && expected !== "unknown";
      if (asserted) score.asserted++;
      if (specified) score.expectedSpecified++;
      if (asserted && got === expected) score.correct++;
      if (specified && got === expected) score.recovered++;
      if (got !== expected) score.errors.push({ id: row.id, expected, got });
    });
  }
  return scores;
}

/* ------------------------------------------------------------------------ */
/* Duplicates                                                                */
/* ------------------------------------------------------------------------ */

export interface DuplicateScore { pairs: number; correct: number; wrongMerges: string[]; missedMerges: string[]; beforeCorrect: number; existingDetected: number; existingExpected: number }

export function scoreDuplicates(): DuplicateScore {
  let correct = 0;
  let beforeCorrect = 0;
  const wrongMerges: string[] = [];
  const missedMerges: string[] = [];
  for (const pair of data.duplicatePairs) {
    const decision = decideDuplicate(resolvePostingIdentity(pair.a), null, [{ table: "opportunities", id: "b", url: pair.b, title: null, employer: null }]);
    const same = decision.decision === "existing_opportunity";
    if (same === pair.same) correct++;
    else if (same) wrongMerges.push(pair.why); else missedMerges.push(pair.why);
    // Before: exact URL (trailing slash trimmed) or PR #123's requisition key on the same host.
    const trim = (url: string) => url.replace(/\/$/, "").toLowerCase();
    const beforeSame = trim(pair.a) === trim(pair.b) || (!!legacyPostingRequisitionId(pair.a)
      && legacyPostingRequisitionId(pair.a) === legacyPostingRequisitionId(pair.b) && new URL(pair.a).hostname === new URL(pair.b).hostname);
    if (beforeSame === pair.same) beforeCorrect++;
  }
  const existing = existingRecords();
  const expectedExisting = EVAL_CASES.filter((row) => row.expected.existingRecord && row.officialUrl);
  const detected = expectedExisting.filter((row) => decideDuplicate(resolvePostingIdentity(row.officialUrl), null, existing).decision === "existing_opportunity").length;
  return { pairs: data.duplicatePairs.length, correct, wrongMerges, missedMerges, beforeCorrect, existingDetected: detected, existingExpected: expectedExisting.length };
}

/* ------------------------------------------------------------------------ */
/* Summary                                                                   */
/* ------------------------------------------------------------------------ */

export interface ArmSummary {
  arm: string;
  identifiable: number;
  discovered: number;
  discoveredEmployerAgnostic: number;
  withOfficialUrl: number;
  candidateAccepted: number;
  requisitionScored: number;
  requisitionCorrect: number;
  attributionClaimed: number;
  attributionCorrect: number;
  reachedReview: number;
  resolvedDecisions: number;
  falseOpen: number;
  causes: Record<string, number>;
  medianCycleDays: number | null;
  rows: RowResult[];
}

function summarize(arm: string, rows: RowResult[]): ArmSummary {
  const identifiable = rows.filter((row) => row.cause !== "not_identifiable");
  const cycles = identifiable.map((row) => row.bestCycleDays).filter((value): value is number => value !== null).sort((a, b) => a - b);
  const causes: Record<string, number> = {};
  for (const row of rows) causes[row.cause] = (causes[row.cause] ?? 0) + 1;
  const withUrl = identifiable.filter((row) => EVAL_CASES.find((item) => item.id === row.id)?.officialUrl);
  return {
    arm,
    identifiable: identifiable.length,
    discovered: identifiable.filter((row) => row.discovered).length,
    discoveredEmployerAgnostic: identifiable.filter((row) => row.discoveredEmployerAgnostic).length,
    withOfficialUrl: withUrl.length,
    candidateAccepted: withUrl.filter((row) => row.candidateAccepted).length,
    requisitionScored: rows.filter((row) => row.requisitionCorrect !== null).length,
    requisitionCorrect: rows.filter((row) => row.requisitionCorrect === true).length,
    attributionClaimed: rows.filter((row) => row.attributionClaimed).length,
    attributionCorrect: rows.filter((row) => row.attributionCorrect === true).length,
    reachedReview: rows.filter((row) => row.cause === "reached_review").length,
    resolvedDecisions: rows.filter((row) => ["reached_review", "closed_on_employer_page", "gate_excluded", "duplicate_existing", "attribution_mismatch"].includes(row.cause)).length,
    falseOpen: rows.filter((row) => row.falseOpen).length,
    causes,
    medianCycleDays: cycles.length ? cycles[Math.floor(cycles.length / 2)] : null,
    rows,
  };
}

/* ------------------------------------------------------------------------ */
/* URL-level attribution, independent of whether discovery reached the row   */
/* ------------------------------------------------------------------------ */

export interface UrlLevelScore {
  arm: string;
  urls: number;
  accepted: number;
  requisitionScored: number;
  requisitionCorrect: number;
  requisitionErrors: Array<{ id: string; expected: string; got: string | null }>;
  attributionClaims: number;
  attributionCorrect: number;
  attributionErrors: Array<{ id: string; employer: string; truth: string | null }>;
}

export function scoreUrlLevel(arm: "before" | "after"): UrlLevelScore {
  const score: UrlLevelScore = { arm, urls: 0, accepted: 0, requisitionScored: 0, requisitionCorrect: 0, requisitionErrors: [], attributionClaims: 0, attributionCorrect: 0, attributionErrors: [] };
  const sources = allTenantSources();
  for (const row of EVAL_CASES) {
    if (!row.officialUrl) continue;
    score.urls++;
    const host = new URL(row.officialUrl).hostname.toLowerCase();
    const identity = resolvePostingIdentity(row.officialUrl);
    const truth = expectedAttribution(row);
    if (row.expected.requisitionId) {
      score.requisitionScored++;
      const got = arm === "before" ? legacyPostingRequisitionId(row.officialUrl) : identity.requisitionId;
      if (got === row.expected.requisitionId.toUpperCase()) score.requisitionCorrect++;
      else score.requisitionErrors.push({ id: row.id, expected: row.expected.requisitionId, got });
    }
    let claimed: boolean;
    let correct: boolean;
    if (arm === "before") {
      // discovery-runner treated any recognized ATS host or known careers
      // domain as an employer-controlled URL for the hinted employer.
      const domain = legacyKnownDomain(row.employer);
      claimed = isRecognizedAtsHost(host) || (!!domain && (host === domain || host.endsWith(`.${domain}`)));
      correct = truth === "match";
    } else {
      const html = fixtureHtml(row);
      const gov = governVerification(identity, sources);
      const assessment = gov.mode === "page" && html && row.page.kind === "readable"
        ? assessFetchedPage({ page: { requestedUrl: row.officialUrl, finalUrl: row.officialUrl, status: 200, body: html.body, contentType: "text/html", redirects: [], retrievedAt: RETRIEVED_AT }, expected: identity })
        : null;
      const status = attributeEmployer({ leadEmployer: row.employer, identity, pageText: assessment?.text ?? null }).status;
      claimed = ["match", "operating_company_confirmed", "page_named"].includes(status);
      // A page-confirmed parent-tenant attribution is correct when the
      // tenant truly hosts the lead employer.
      correct = truth === "match" || (truth === "needs_page" && status !== "match");
    }
    if (claimed) {
      score.attributionClaims++;
      if (correct) score.attributionCorrect++;
      else score.attributionErrors.push({ id: row.id, employer: row.employer, truth });
    }
    if (claimed) score.accepted++;
  }
  return score;
}

export function runEvaluation(): { before: ArmSummary; afterAllTenants: ArmSummary; afterProduction: ArmSummary; gates: GateScore[]; duplicates: DuplicateScore; urlLevel: { before: UrlLevelScore; after: UrlLevelScore }; attributionTraps: ReturnType<typeof scoreAttributionTraps>; queryCounts: { before: number; after: number } } {
  const schedules = { before: beforeSchedule(), after: afterSchedule() };
  return {
    before: summarize("before (PR #123 head)", EVAL_CASES.map((row) => replayRow(row, "before", "production", schedules))),
    afterAllTenants: summarize("after, every eval tenant governed (mechanism)", EVAL_CASES.map((row) => replayRow(row, "after", "all_tenants", schedules))),
    afterProduction: summarize("after, documented production sources", EVAL_CASES.map((row) => replayRow(row, "after", "production", schedules))),
    gates: scoreGates(),
    duplicates: scoreDuplicates(),
    urlLevel: { before: scoreUrlLevel("before"), after: scoreUrlLevel("after") },
    attributionTraps: scoreAttributionTraps(),
    queryCounts: { before: schedules.before.length, after: schedules.after.length },
  };
}
