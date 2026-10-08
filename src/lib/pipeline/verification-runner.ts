/**
 * verification-runner.ts — the bounded loop between an indexed candidate URL
 * and a reviewable, evidence-bearing employer posting.
 *
 *   select   bounded candidates from source research and discovery leads
 *   identify tenant + requisition (posting-identity.ts), dedupe BEFORE fetching
 *   govern   fetch only under an enabled job_sources row whose terms, robots
 *            and scheduling state pass sourceGovernanceError(), and which
 *            explicitly scopes requisition verification to the host/path.
 *            A feed source (Greenhouse/Lever/Ashby) answers from its own
 *            archived source_postings instead of fetching again.
 *   fetch    safeFetch (SSRF guards, redirect capture); Scrapling only when the
 *            operator has enabled it. The paid tier is never used here.
 *   assess   page state + gates with verbatim quotes (posting-evidence.ts)
 *   decide   outcome (posting-verification.ts)
 *   record   private snapshot + append-only posting_verifications row; a
 *            private task only for a distinct review candidate.
 *
 * It never logs in, never retries a 401/403/429, never bypasses robots or
 * source restrictions, never writes to opportunities, and never publishes.
 */
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { IngestionStorageClient } from "../ingestion/persistence/repository";
import { sourceGovernanceError, type RunnableJobSource } from "../ingestion/source-runner";
import { sourceInstitutionRestriction } from "../ingestion/source-eligibility";
import { looksUnusable } from "./fetch-chain";
import { assessFetchedPage, unknownGates, pageText, type FetchedPage, type PageAssessment } from "./posting-evidence";
import { isEmployerRequisitionUrl, resolvePostingIdentity, type PostingIdentity } from "./posting-identity";
import { decideVerification, type ExistingRecord, type VerificationDecision, type VerificationLead } from "./posting-verification";
import { safeFetch, type SafeFetchResponse } from "./safe-fetch";
import type { RenderedRequisition } from "./scraping-clients";
import { redactContacts } from "./contact-redaction";
export { redactContacts } from "./contact-redaction";

export interface VerificationCandidate extends VerificationLead {
  discoveryLeadId: string | null;
  userSubmissionId: string | null;
  firstSeenAt: string | null;
}

export interface VerificationSourceRow extends RunnableJobSource {
  last_successful_at: string | null;
}

export interface VerificationScope {
  enabled: boolean;
  hosts: string[];
  pathPrefixes: string[];
  tenantKey: string | null;
}

export type Governance =
  | { mode: "feed"; source: VerificationSourceRow }
  | { mode: "page"; source: VerificationSourceRow }
  | { mode: "blocked"; status: "no_governed_source" | "source_policy_blocked"; reason: string; source: VerificationSourceRow | null };

export interface VerificationRunReport {
  runId: string;
  dryRun: boolean;
  considered: number;
  skippedRecent: number;
  /** Waiting for a later run because this host hit a run-local limit. */
  deferred: number;
  fetched: number;
  recorded: number;
  reviewTasks: number;
  outcomes: Record<string, number>;
  /** Tenants that blocked verification because no governed source covers them. */
  governanceGaps: Record<string, number>;
  decisions: Array<{ url: string; employer: string | null; title: string | null; outcome: string; pageState: string; reasons: string[] }>;
  errors: string[];
}

export type PageFetcher = (url: string) => Promise<SafeFetchResponse>;

const FEED_KINDS = new Set(["greenhouse", "lever", "ashby"]);
const RECHECK_DAYS = 7;
const DEFAULT_HOST_SPACING_MS = 2_000;
const MAX_PER_HOST = 3;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function verificationScope(source: Pick<RunnableJobSource, "config_json">): VerificationScope | null {
  const raw = source.config_json?.requisition_verification;
  if (!raw || typeof raw !== "object") return null;
  const scope = raw as Record<string, unknown>;
  const hosts = Array.isArray(scope.hosts) ? scope.hosts.filter((host): host is string => typeof host === "string").map((host) => host.toLowerCase()) : [];
  const pathPrefixes = Array.isArray(scope.path_prefixes)
    ? scope.path_prefixes.filter((prefix): prefix is string => typeof prefix === "string" && prefix.startsWith("/"))
    : [];
  return { enabled: scope.enabled === true, hosts, pathPrefixes,
    tenantKey: typeof scope.tenant_key === "string" ? scope.tenant_key : null };
}

/**
 * Officer-set requisition verification scope for one reviewed source. The
 * scope is limited to the source's own careers host; path prefixes narrow it
 * further. `verificationOnly` keeps the scheduler from list-fetching the
 * careers landing page when only individual requisitions should be checked.
 */
export function buildVerificationScope(input: {
  careersUrl: string;
  enabled: boolean;
  verificationOnly: boolean;
  pathPrefixes: string;
  reviewedBy: string;
  reviewedOn: string;
}): Record<string, unknown> {
  const url = new URL(input.careersUrl);
  if (url.protocol !== "https:") throw new Error("Requisition verification requires an HTTPS careers URL");
  const tenantKey = resolvePostingIdentity(url.toString()).tenantKey;
  if (!tenantKey) throw new Error("Careers URL must identify a specific recruiting tenant");
  const prefixes = input.pathPrefixes.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  if (input.enabled && prefixes.length === 0) throw new Error("An enabled verification scope requires a specific job path prefix");
  for (const prefix of prefixes) {
    if (!prefix.startsWith("/") || prefix === "/" || prefix.includes("..") || prefix.length > 200) throw new Error(`Invalid path prefix: ${prefix}`);
  }
  return {
    enabled: input.enabled,
    verification_only: input.verificationOnly,
    hosts: [url.hostname.toLowerCase()],
    tenant_key: tenantKey,
    path_prefixes: prefixes.slice(0, 10),
    reviewed_by: input.reviewedBy,
    reviewed_on: input.reviewedOn,
  };
}

function feedIdentifier(source: RunnableJobSource): string | null {
  const configured = source.config_json?.boardToken;
  return (typeof configured === "string" ? configured : source.source_identifier)?.toLowerCase() ?? null;
}

/**
 * Governance is decided per tenant, not per hostname family: a reviewed
 * Greenhouse board for Ginkgo authorizes nothing for another board on the same
 * host. A search hit never becomes a crawl target by itself.
 */
export function governVerification(identity: PostingIdentity, sources: VerificationSourceRow[]): Governance {
  let candidate: VerificationSourceRow | null = null;
  let mode: "feed" | "page" | null = null;
  for (const source of sources) {
    const board = identity.tenantKey?.split("/").at(-1) ?? null;
    if (FEED_KINDS.has(source.source_kind) && identity.system === source.source_kind && board && feedIdentifier(source) === board) {
      candidate = source; mode = "feed"; break;
    }
    const scope = verificationScope(source);
    if (scope?.tenantKey && identity.tenantKey === scope.tenantKey && identity.url && identity.host
      && new URL(identity.url).protocol === "https:" && scope.hosts.includes(identity.host)) {
      const path = new URL(identity.url).pathname;
      if (scope.pathPrefixes.length > 0 && scope.pathPrefixes.some((prefix) => path.startsWith(prefix))) {
        candidate = source; mode = "page";
        if (scope.enabled) break;
      }
    }
  }
  if (!candidate || !mode) {
    return { mode: "blocked", status: "no_governed_source", source: null,
      reason: `No reviewed job source covers ${identity.tenantKey ?? identity.host}; register and review one before automatic verification` };
  }
  const policy = sourceGovernanceError(candidate);
  if (policy) return { mode: "blocked", status: "source_policy_blocked", source: candidate, reason: `${candidate.source_name}: ${policy}` };
  if (mode === "page" && !verificationScope(candidate)?.enabled) {
    return { mode: "blocked", status: "source_policy_blocked", source: candidate,
      reason: `${candidate.source_name}: requisition_verification is not enabled for this source` };
  }
  return { mode, source: candidate };
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Bounded candidate selection: officer research first, then recent leads. */
export async function loadVerificationCandidates(db: SupabaseClient, scanLimit = 250): Promise<VerificationCandidate[]> {
  const [submissions, leads] = await Promise.all([
    db.from("user_submissions").select("id,payload,created_at")
      .eq("status", "new").eq("payload->>intake_stage", "source_research")
      .order("created_at", { ascending: true }).limit(scanLimit),
    db.from("discovery_leads")
      .select("id,original_url,normalized_url,canonical_employer_url,latest_title,employer_hint,first_seen_at,resolution")
      .in("officer_status", ["new", "in_review"]).in("resolution", ["unresolved", "official_source_found"])
      .order("last_seen_at", { ascending: false }).limit(scanLimit),
  ]);
  if (submissions.error) throw new Error(`load source research: ${submissions.error.message}`);
  if (leads.error) throw new Error(`load discovery leads: ${leads.error.message}`);
  const out: VerificationCandidate[] = [];
  for (const row of (submissions.data ?? []) as Array<{ id: string; payload: Record<string, unknown>; created_at: string }>) {
    const url = payloadString(row.payload, "candidate_employer_url");
    if (!url) continue;
    out.push({
      url, employer: payloadString(row.payload, "company"), title: payloadString(row.payload, "title"),
      location: payloadString(row.payload, "location"), cycle: payloadString(row.payload, "term") ?? payloadString(row.payload, "season"),
      discoveryLeadId: null, userSubmissionId: row.id, firstSeenAt: row.created_at,
    });
  }
  for (const row of (leads.data ?? []) as Array<Record<string, string | null>>) {
    const url = row.canonical_employer_url ?? row.normalized_url ?? row.original_url;
    if (!url) continue;
    const identity = resolvePostingIdentity(url);
    if (!isEmployerRequisitionUrl(identity)) continue;
    // Lane searches have no employer hint; a single-employer tenant supplies
    // one. A shared tenant never does.
    const employer = row.employer_hint ?? (identity.tenant && !identity.tenant.shared ? identity.tenant.employer : null);
    out.push({
      url, employer, title: row.latest_title, location: null, cycle: null,
      discoveryLeadId: row.id as string, userSubmissionId: null, firstSeenAt: row.first_seen_at,
    });
  }
  return out;
}

function like(value: string): string {
  return `%${value.replace(/[%_\\]/g, (match) => `\\${match}`)}%`;
}

/** Existing records across every table that may already hold this role. */
export async function loadExistingRecords(db: SupabaseClient, identity: PostingIdentity): Promise<ExistingRecord[]> {
  const url = identity.url;
  if (!url) return [];
  const urls = [url, `${url}/`];
  const req = identity.requisitionId;
  const empty = Promise.resolve({ data: [] as unknown[], error: null });
  const [opps, oppsByReq, postings, postingsByReq, leads, research, prior] = await Promise.all([
    db.from("opportunities").select("id,posting_url,title,status").in("posting_url", urls).limit(10),
    req ? db.from("opportunities").select("id,posting_url,title,status").ilike("posting_url", like(req)).limit(25) : empty,
    db.from("source_postings").select("id,canonical_url,external_posting_id,title_raw,employer_name_raw,current_status").in("canonical_url", urls).limit(10),
    req ? db.from("source_postings").select("id,canonical_url,external_posting_id,title_raw,employer_name_raw,current_status").eq("external_posting_id", req).limit(25) : empty,
    req ? db.from("discovery_leads").select("id,normalized_url,original_url,latest_title,employer_hint,resolution").or(`normalized_url.ilike.${like(req)},original_url.ilike.${like(req)}`).limit(25) : empty,
    req ? db.from("user_submissions").select("id,payload,status").ilike("payload->>candidate_employer_url", like(req)).limit(25) : empty,
    db.from("posting_verifications").select("id,canonical_url,lead_title,lead_employer,outcome,created_at")
      .eq(identity.identityKey ? "identity_key" : "canonical_url", identity.identityKey ?? url)
      .order("created_at", { ascending: false }).limit(5),
  ]);
  const failure = [opps, oppsByReq, postings, postingsByReq, leads, research, prior].find((result) => result.error);
  if (failure?.error) throw new Error(`duplicate check: ${failure.error.message}`);
  const rows = <T>(result: { data: unknown }) => (result.data ?? []) as T[];
  const out: ExistingRecord[] = [];
  for (const row of [...rows<Record<string, string>>(opps), ...rows<Record<string, string>>(oppsByReq)]) {
    out.push({ table: "opportunities", id: row.id, url: row.posting_url, title: row.title, employer: null, status: row.status });
  }
  for (const row of [...rows<Record<string, string>>(postings), ...rows<Record<string, string>>(postingsByReq)]) {
    out.push({ table: "source_postings", id: row.id, url: row.canonical_url, title: row.title_raw, employer: row.employer_name_raw,
      requisitionId: row.external_posting_id, status: row.current_status });
  }
  for (const row of rows<Record<string, string>>(leads)) {
    out.push({ table: "discovery_leads", id: row.id, url: row.normalized_url ?? row.original_url, title: row.latest_title, employer: row.employer_hint, status: row.resolution });
  }
  for (const row of rows<{ id: string; payload: Record<string, unknown>; status: string }>(research)) {
    out.push({ table: "user_submissions", id: row.id, url: payloadString(row.payload, "candidate_employer_url"),
      title: payloadString(row.payload, "title"), employer: payloadString(row.payload, "company"), status: row.status });
  }
  for (const row of rows<Record<string, string>>(prior)) {
    out.push({ table: "posting_verifications", id: row.id, url: row.canonical_url, title: row.lead_title, employer: row.lead_employer,
      status: row.outcome, createdAt: row.created_at });
  }
  return out;
}

/** Do not let unchanged, ungoverned leads consume the bounded batch forever. */
export function skipPriorVerification(existing: ExistingRecord[], governance: Governance, now: Date): boolean {
  const latest = existing.find((record) => record.table === "posting_verifications");
  if (!latest) return false;
  if (latest.status === "unresolved_governance") {
    // A newly approved source must make this lead eligible immediately.
    return governance.mode === "blocked";
  }
  // A landing page or secondary URL can never become a requisition without
  // changing its URL. It should be archived once, not every seven days.
  if (latest.status === "rejected_not_requisition") return true;
  return Date.parse(latest.createdAt ?? "") > now.valueOf() - RECHECK_DAYS * 86_400_000;
}

function taskNotes(candidate: VerificationCandidate, decision: VerificationDecision, retrievedAt: string, pageTitle: string | null): string {
  const g = decision.gates;
  const line = (label: string, value: string, quote: string | null) => `${label}: ${value}${quote ? ` — "${quote.slice(0, 220)}"` : ""}`;
  return redactContacts([
    `Verified employer requisition: ${candidate.employer ?? "unknown employer"} — ${pageTitle ?? candidate.title ?? "untitled"} (${decision.identity.requisitionId ?? "no requisition ID"})`,
    decision.identity.url ?? candidate.url,
    `Apply control visible in stored employer text at ${retrievedAt}. This is not publication approval.`,
    line("Deadline", g.deadline.value, g.deadline.quote),
    line("Term", g.term.value, g.term.quote),
    line("Degree", g.degreeLevel.value, g.degreeLevel.quote),
    line("Continued enrollment", g.continuedEnrollment.value, g.continuedEnrollment.quote),
    line("Institution", g.institutionRestriction.value, g.institutionRestriction.quote),
    line("Work authorization", g.workAuthorization.value, g.workAuthorization.quote),
    ...decision.reasons.slice(1).map((reason) => `Note: ${reason}`),
  ].join("\n"));
}

function redactGates(gates: VerificationDecision["gates"]): VerificationDecision["gates"] {
  return Object.fromEntries(Object.entries(gates).map(([key, value]) => [key, {
    ...value, quote: value.quote ? redactContacts(value.quote) : null,
  }])) as VerificationDecision["gates"];
}

async function fetchPage(url: string, fetcher: PageFetcher, scrapling: ((url: string) => Promise<string | RenderedRequisition>) | null): Promise<FetchedPage & { tier: 0 | 1; tierNote: string | null; attested: boolean }> {
  const retrievedAt = new Date().toISOString();
  try {
    const response = await fetcher(url);
    if (!("body" in response)) {
      return { requestedUrl: url, finalUrl: response.finalUrl, status: 304, body: null, redirects: response.redirects ?? [], retrievedAt, tier: 0, tierNote: null, attested: true };
    }
    const page: FetchedPage & { tier: 0 | 1; tierNote: string | null; attested: boolean } = {
      requestedUrl: url, finalUrl: response.finalUrl, status: response.status, contentType: response.contentType ?? null,
      body: response.body, redirects: response.redirects ?? [], retrievedAt, tier: 0, tierNote: null, attested: true,
    };
    // Rendering is a fetch tier, not a bypass: it runs only for a governed
    // source, only when the operator enabled Scrapling, and only on a 200 shell.
    if (scrapling && response.status === 200 && looksUnusable(response.body)) {
      try {
        const rendered = await scrapling(response.finalUrl);
        if (typeof rendered === "string") {
          return { ...page, body: rendered, contentType: "text/html", tier: 1, attested: false,
            tierNote: "renderer returned HTML without final URL metadata" };
        }
        const hops = rendered.history.map((item, index) => ({
          url: item.url, status: item.status,
          location: rendered.history[index + 1]?.url ?? rendered.finalUrl,
        }));
        return { ...page, body: rendered.html, finalUrl: rendered.finalUrl, status: rendered.status,
          redirects: [...(response.redirects ?? []), ...hops], contentType: "text/html", tier: 1, attested: true,
          tierNote: "tier 0 returned a script shell; rendered with attested URL metadata" };
      } catch (error) {
        return { ...page, tierNote: `Scrapling failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    return page;
  } catch (error) {
    return { requestedUrl: url, finalUrl: null, status: 0, body: null, redirects: [], retrievedAt, tier: 0, attested: false,
      tierNote: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
}

export async function runPostingVerificationBatch(params: {
  db: SupabaseClient;
  storage: IngestionStorageClient;
  limit?: number;
  now?: Date;
  runId?: string;
  dryRun?: boolean;
  fetcher?: PageFetcher;
  scrapling?: ((url: string) => Promise<string | RenderedRequisition>) | null;
  hostSpacingMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<VerificationRunReport> {
  const now = params.now ?? new Date();
  const limit = params.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("verification limit must be an integer from 1 to 20");
  const runId = params.runId ?? `verify:${now.toISOString().slice(0, 10)}`;
  // Refuse cross-origin redirects before requesting their target. A reviewed
  // source authorizes its own host, not every site it might redirect to.
  const fetcher = params.fetcher ?? ((url: string) => safeFetch(url, { restrictOrigin: new URL(url).origin }));
  const sleep = params.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const spacing = params.hostSpacingMs ?? DEFAULT_HOST_SPACING_MS;
  const report: VerificationRunReport = {
    runId, dryRun: !!params.dryRun, considered: 0, skippedRecent: 0, deferred: 0, fetched: 0, recorded: 0, reviewTasks: 0,
    outcomes: {}, governanceGaps: {}, decisions: [], errors: [],
  };

  const { data: sourceRows, error: sourceError } = await params.db.from("job_sources")
    .select("id, source_name, source_kind, source_identifier, careers_url, api_endpoint, config_json, enabled, terms_reviewed, terms_review_date, robots_reviewed, automatic_scheduling_paused_at, consecutive_failures, fetch_tier, tier_clean_runs, last_successful_at");
  if (sourceError) throw new Error(`load job sources: ${sourceError.message}`);
  const sources = (sourceRows ?? []) as VerificationSourceRow[];

  const seen = new Set<string>();
  const hostLastFetch = new Map<string, number>();
  const hostCount = new Map<string, number>();
  const blockedHosts = new Set<string>();
  const candidates = await loadVerificationCandidates(params.db);

  for (const candidate of candidates) {
    if (report.considered >= limit) break;
    const identity = resolvePostingIdentity(candidate.url);
    const key = identity.identityKey ?? identity.url ?? candidate.url;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const existing = await loadExistingRecords(params.db, identity);
      const governance = isEmployerRequisitionUrl(identity)
        ? governVerification(identity, sources)
        : { mode: "blocked" as const, status: "no_governed_source" as const, reason: "Not an individual employer requisition URL", source: null };
      if (skipPriorVerification(existing, governance, now)) { report.skippedRecent++; continue; }
      // A run-local host cap is not a property of the posting or its source.
      // Do not archive an unfetched row and put it on a seven-day cooldown.
      const preliminary = decideVerification({ lead: candidate, assessment: null, existing, retrievedAt: now.toISOString() });
      const skipFetch = ["rejected_not_requisition", "rejected_attribution", "duplicate_existing"].includes(preliminary.outcome);
      const host = identity.host ?? "";
      if (!skipFetch && governance.mode === "page" && (blockedHosts.has(host) || (hostCount.get(host) ?? 0) >= MAX_PER_HOST)) {
        report.deferred++;
        continue;
      }
      report.considered++;
      let assessment: PageAssessment | null = null;
      let fetched: (FetchedPage & { tier: 0 | 1; tierNote: string | null; attested: boolean }) | null = null;
      let snapshotPath: string | null = null;
      let contentHash: string | null = null;
      let sourcePostingId: string | null = null;
      let sourcePayloadId: string | null = null;
      let governanceStatus: string = "not_required";
      let governanceReason: string | null = null;

      // Dedupe first: an existing opportunity or source posting needs no fetch.
      if (!skipFetch && governance.mode === "blocked") {
        governanceStatus = governance.status;
        governanceReason = governance.reason;
        const gapKey = identity.tenantKey ?? identity.host ?? "unknown";
        if (governance.status === "no_governed_source") report.governanceGaps[gapKey] = (report.governanceGaps[gapKey] ?? 0) + 1;
      } else if (!skipFetch && governance.mode === "feed") {
        governanceStatus = "feed_record";
        const { data, error } = await params.db.from("source_postings")
          .select("id,last_payload_id,canonical_url,external_posting_id,title_raw,current_status")
          .eq("job_source_id", governance.source.id).eq("external_posting_id", identity.requisitionId ?? "").limit(1);
        if (error) throw new Error(`feed lookup: ${error.message}`);
        const posting = (data ?? [])[0] as Record<string, string> | undefined;
        if (posting) {
          sourcePostingId = posting.id;
          sourcePayloadId = posting.last_payload_id ?? null;
          existing.push({ table: "source_postings", id: posting.id, url: posting.canonical_url, title: posting.title_raw,
            employer: null, requisitionId: posting.external_posting_id, status: posting.current_status });
        } else {
          assessment = { state: "ambiguous", text: null, pageTitle: null, finalIdentity: null, requisitionIdsOnPage: [], gates: unknownGates(),
            reason: `Requisition is not in the governed ${governance.source.source_name} feed (last successful fetch ${governance.source.last_successful_at ?? "never"}); it may be unlisted, closed, or newer than the feed` };
        }
      } else if (!skipFetch && governance.mode === "page") {
        governanceStatus = "fetched";
        const wait = (hostLastFetch.get(host) ?? 0) + spacing - Date.now();
        if (wait > 0) await sleep(wait);
        fetched = await fetchPage(identity.url as string, fetcher, params.scrapling ?? null);
        hostLastFetch.set(host, Date.now());
        hostCount.set(host, (hostCount.get(host) ?? 0) + 1);
        report.fetched++;
        if ([401, 403, 429].includes(fetched.status)) blockedHosts.add(host);
        // A redirect that leaves the reviewed host is not evidence from that
        // host: nothing from the foreign page is stored or assessed.
        const scopeHosts = verificationScope(governance.source)?.hosts ?? [];
        let finalHost: string | null = null;
        try {
          const final = fetched.finalUrl ? new URL(fetched.finalUrl) : null;
          finalHost = final?.protocol === "https:" ? final.hostname.toLowerCase() : null;
        } catch { finalHost = null; }
        const outsideScope = (value: string) => {
          try {
            const target = new URL(value);
            return target.protocol !== "https:" || !scopeHosts.includes(target.hostname.toLowerCase());
          } catch { return true; }
        };
        const leftScope = fetched.redirects?.some((hop) => outsideScope(hop.url) || outsideScope(hop.location));
        if (fetched.body && (!finalHost || !scopeHosts.includes(finalHost) || leftScope)) {
          fetched = { ...fetched, body: null };
          assessment = { state: "redirected_away", text: null, pageTitle: null, finalIdentity: resolvePostingIdentity(fetched.finalUrl), requisitionIdsOnPage: [],
            gates: unknownGates(), reason: `Renderer or redirect left the reviewed host; the foreign page was not stored` };
        } else {
          assessment = assessFetchedPage({ page: fetched, expected: identity });
          // A legacy renderer may return only HTML. Archive its text for
          // investigation; only structured URL metadata can support review.
          if (fetched.tier === 1 && !fetched.attested && assessment.state === "apply_visible") {
            assessment = { ...assessment, state: "ambiguous", gates: unknownGates(),
              reason: "Rendered page has no attested final URL; confirm the requisition and Apply flow manually" };
          }
        }
        if (fetched.body) {
          contentHash = sha256(fetched.body);
          snapshotPath = `verification/${governance.source.id}/${fetched.retrievedAt.slice(0, 10)}/${contentHash}.txt`;
          if (!params.dryRun) {
            const upload = await params.storage.from("source-payloads").upload(snapshotPath, new TextEncoder().encode(fetched.body), {
              contentType: "text/plain; charset=utf-8", upsert: false,
            });
            if (upload.error && !/already exists/i.test(upload.error.message)) throw new Error(`snapshot upload: ${upload.error.message}`);
          }
        }
      }

      const decision = decideVerification({
        lead: candidate, assessment, governanceReason, existing, retrievedAt: fetched?.retrievedAt ?? now.toISOString(),
      });
      // Institution-restricted boards stay excluded even when the page is silent.
      const restriction = governance.mode !== "blocked" ? sourceInstitutionRestriction(governance.source) : null;
      if (restriction && decision.outcome === "review_candidate") {
        decision.outcome = "gate_excluded";
        decision.reasons.push(restriction);
      }
      report.outcomes[decision.outcome] = (report.outcomes[decision.outcome] ?? 0) + 1;
      const pageState = assessment?.state ?? "not_fetched";
      report.decisions.push({ url: candidate.url, employer: candidate.employer, title: candidate.title, outcome: decision.outcome, pageState, reasons: decision.reasons });

      const row = {
        verification_key: sha256(JSON.stringify([identity.identityKey ?? identity.url ?? candidate.url, contentHash ?? pageState, decision.outcome, runId])),
        run_id: runId,
        identity_key: identity.identityKey,
        observed_url: candidate.url,
        canonical_url: identity.url,
        final_url: fetched?.finalUrl ?? null,
        redirect_chain: fetched?.redirects ?? [],
        http_status: fetched && fetched.status >= 100 ? fetched.status : null,
        content_type: fetched?.contentType ?? null,
        retrieved_at: fetched?.retrievedAt ?? null,
        content_sha256: contentHash,
        snapshot_storage_path: snapshotPath,
        source_payload_id: sourcePayloadId,
        source_posting_id: sourcePostingId,
        job_source_id: governance.mode !== "blocked" ? governance.source.id : governance.source?.id ?? null,
        governance_status: governanceStatus,
        governance_reason: governanceReason ?? (fetched?.tierNote ?? null),
        discovery_lead_id: candidate.discoveryLeadId,
        user_submission_id: candidate.userSubmissionId,
        lead_employer: candidate.employer,
        lead_title: candidate.title,
        lead_first_seen_at: candidate.firstSeenAt,
        ats_system: identity.system,
        tenant_key: identity.tenantKey,
        requisition_id: identity.requisitionId,
        page_state: pageState,
        page_title: assessment?.pageTitle ?? null,
        outcome: decision.outcome,
        reasons: decision.reasons.map((reason) => redactContacts(reason).slice(0, 1000)),
        comparison: decision.comparison,
        duplicates: decision.duplicates,
        gates: redactGates(decision.gates),
        review_priority: decision.reviewPriority,
        task_notes: decision.outcome === "review_candidate" ? taskNotes(candidate, decision, fetched?.retrievedAt ?? now.toISOString(), assessment?.pageTitle ?? null) : null,
      };
      if (params.dryRun) continue;
      const { data, error } = await params.db.rpc("record_posting_verification", { p_row: row });
      if (error) throw new Error(`record verification: ${error.message}`);
      const result = (Array.isArray(data) ? data[0] : data) as { review_task_id?: string | null; created?: boolean } | null;
      if (result?.created) report.recorded++;
      if (result?.review_task_id) report.reviewTasks++;
    } catch (error) {
      report.errors.push(`${candidate.url}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500));
    }
  }
  return report;
}

/** Exposed for tests and the evaluation replay: same text conversion as storage. */
export const snapshotText = pageText;
