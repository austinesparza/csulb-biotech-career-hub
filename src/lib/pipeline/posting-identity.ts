/**
 * posting-identity.ts — what a job URL actually identifies.
 *
 * A search index hands us a URL. Before anything else we need to know which
 * recruiting tenant it belongs to, which individual requisition (if any) it
 * names, and whether the tenant belongs to the employer the lead claims. None
 * of this proves a job is open; it only prevents two classic errors:
 *
 *   1. trusting an ATS hostname: danaher.wd1.myworkdayjobs.com hosts Aldevron,
 *      Beckman Coulter and a dozen other companies; www.zintellect.com hosts
 *      FDA, Army and NIH appointments; a Greenhouse host hosts everyone.
 *   2. treating a board, search page or marketing landing page as a role.
 *
 * Pure: no network, no database. The tenant registry is identity metadata only
 * and never authorizes a fetch (see verification-runner.ts for governance).
 */
import registry from "../../../data/ats-tenant-registry.json";
import { canonicalizeUrl } from "../ingestion/normalize";

export type PostingSystem =
  | "greenhouse" | "greenhouse_embed" | "workday" | "lever" | "ashby" | "icims" | "yello"
  | "prismhr" | "adp" | "phenom" | "radancy" | "successfactors" | "jnj" | "program"
  | "employer_site" | "linkedin" | "aggregator" | "unknown";

export interface TenantRecord {
  kind: string;
  host: string;
  site: string | null;
  employer: string;
  aliases: string[];
  operatingCompanies: string[];
  shared?: boolean;
  institutionRestriction?: string;
}

export interface PostingIdentity {
  /** Canonical URL (tracking removed). Null when the URL is unusable. */
  url: string | null;
  host: string | null;
  system: PostingSystem;
  /** Stable tenant key, e.g. `roche.wd3.myworkdayjobs.com/rog-a2o-gene`. */
  tenantKey: string | null;
  /** Employer requisition or posting ID visible in the URL, normalized. */
  requisitionId: string | null;
  /** True only when the URL points at one individual posting. */
  detailPage: boolean;
  /** Tenant registry match, when known. */
  tenant: TenantRecord | null;
  /**
   * Key used for cross-table duplicate detection. Locale, location path
   * segments, tracking parameters and trailing slashes do not change it.
   * Null when no individual requisition can be identified.
   */
  identityKey: string | null;
  notes: string[];
}

const TENANTS = (registry as { tenants: TenantRecord[] }).tenants.map((tenant) => ({
  ...tenant,
  host: tenant.host.toLowerCase(),
  site: tenant.site?.toLowerCase() ?? null,
}));

const AGGREGATOR_HOSTS = [
  "indeed.com", "glassdoor.com", "ziprecruiter.com", "biospace.com", "simplyhired.com", "talent.com",
  "jobleads.com", "tallo.com", "internships.com", "builtin.com", "handshake.com", "joinhandshake.com",
  "themuse.com", "jobilize.com", "monster.com", "lensa.com", "wellfound.com", "dice.com",
];

const LOCALE = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LISTING_SEGMENTS = new Set([
  "jobs", "job", "search", "search_jobs", "search-jobs", "careers", "career", "job-search", "openings",
  "opportunities", "current-opportunities", "students", "internships", "early-careers", "university",
]);

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Workday appends "-1", "-2" to a requisition when the same requisition is
 * re-posted (R0026869-1). The requisition itself is the prefix. Numeric IDs
 * such as Roche's 202608-121913 are left intact because stripping would
 * destroy the ID.
 */
export function normalizeWorkdayRequisition(raw: string): string {
  const upper = raw.toUpperCase();
  const reposted = upper.match(/^((?:[A-Z]{1,4}[-_]?)\d{4,}(?:[-_]\d{4,})?)[-_]\d{1,2}$/);
  return reposted ? reposted[1] : upper;
}

function lastSegment(parts: string[]): string {
  return parts.at(-1) ?? "";
}

function findTenant(host: string, site: string | null): TenantRecord | null {
  const exact = TENANTS.find((tenant) => tenant.host === host && tenant.site !== null && tenant.site === site);
  if (exact) return exact;
  return TENANTS.find((tenant) => tenant.host === host && tenant.site === null) ?? null;
}

function identity(
  partial: Omit<PostingIdentity, "identityKey" | "tenant"> & { tenant?: TenantRecord | null },
): PostingIdentity {
  const tenant = partial.tenant ?? null;
  const identityKey = partial.detailPage && partial.requisitionId && partial.tenantKey
    ? `${partial.system}:${partial.tenantKey}:${partial.requisitionId}`.toLowerCase()
    : null;
  return { ...partial, tenant, identityKey };
}

/** Parse a job URL into tenant and requisition identity. Never throws. */
export function resolvePostingIdentity(rawUrl: string | null | undefined): PostingIdentity {
  const url = canonicalizeUrl(rawUrl ?? null);
  const empty = { url, host: null, tenantKey: null, requisitionId: null, detailPage: false, notes: [] as string[] };
  if (!url) return identity({ ...empty, system: "unknown", notes: ["URL could not be parsed"] });
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const base = { url, host, notes: [] as string[] };

  if (hostMatches(host, "linkedin.com") || host === "lnkd.in") {
    return identity({ ...base, system: "linkedin", tenantKey: null, requisitionId: null, detailPage: false,
      notes: ["LinkedIn is a discovery surface; it cannot establish employer publication facts"] });
  }
  if (AGGREGATOR_HOSTS.some((domain) => hostMatches(host, domain))) {
    return identity({ ...base, system: "aggregator", tenantKey: null, requisitionId: null, detailPage: false,
      notes: ["Aggregator or syndicated copy; find the employer requisition"] });
  }

  // Greenhouse hosted boards: /{board}/jobs/{id}
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    const board = parts[0]?.toLowerCase() ?? null;
    const id = parts[1] === "jobs" && /^\d{5,}$/.test(parts[2] ?? "") ? parts[2] : null;
    return identity({ ...base, system: "greenhouse", tenantKey: board ? `greenhouse/${board}` : null,
      requisitionId: id, detailPage: !!id, tenant: board ? findTenant("job-boards.greenhouse.io", board) : null,
      notes: id ? [] : ["Greenhouse board or listing page, not an individual job"] });
  }

  // Greenhouse embedded on an employer site: ?gh_jid=123
  const ghJid = parsed.searchParams.get("gh_jid");
  if (ghJid && /^\d{5,}$/.test(ghJid)) {
    return identity({ ...base, system: "greenhouse_embed", tenantKey: `embed/${host}`, requisitionId: ghJid,
      detailPage: true, tenant: findTenant(host, null),
      notes: ["Greenhouse job embedded in an employer page; the embed may require JavaScript"] });
  }

  // Workday: {tenant}.wd{n}.myworkdayjobs.com/[locale/]{site}/job/[location/]{slug}_{id}
  if (host.endsWith(".myworkdayjobs.com")) {
    const rest = LOCALE.test(parts[0] ?? "") ? parts.slice(1) : parts;
    const site = rest[0]?.toLowerCase() ?? null;
    const jobIndex = rest.indexOf("job");
    const slug = jobIndex >= 0 ? lastSegment(rest) : "";
    const rawId = slug.includes("_") ? slug.slice(slug.lastIndexOf("_") + 1) : "";
    const valid = jobIndex >= 0 && rest.length > jobIndex + 1 && /^[A-Z0-9][A-Z0-9-]{3,}$/i.test(rawId) && /\d{4,}/.test(rawId);
    return identity({ ...base, system: "workday", tenantKey: site ? `${host}/${site}` : host,
      requisitionId: valid ? normalizeWorkdayRequisition(rawId) : null, detailPage: valid,
      tenant: findTenant(host, site),
      notes: valid ? ["Workday detail pages are client-rendered; plain HTTP fetches usually return a script shell"]
        : ["Workday site or search page, not an individual job"] });
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co" || host === "jobs.ashbyhq.com") {
    const board = parts[0]?.toLowerCase() ?? null;
    const id = parts[1] && UUID.test(parts[1]) ? parts[1].toLowerCase() : null;
    const system = host === "jobs.ashbyhq.com" ? "ashby" : "lever";
    return identity({ ...base, system, tenantKey: board ? `${system}/${board}` : null, requisitionId: id,
      detailPage: !!id, tenant: findTenant(host, board), notes: id ? [] : ["Board page, not an individual job"] });
  }

  // iCIMS: careers-{tenant}.icims.com/jobs/{id}/{slug}/job
  if (host.endsWith(".icims.com")) {
    const id = parts[0] === "jobs" && /^\d{3,}$/.test(parts[1] ?? "") ? parts[1] : null;
    return identity({ ...base, system: "icims", tenantKey: host, requisitionId: id, detailPage: !!id,
      tenant: findTenant(host, null), notes: id ? [] : ["iCIMS search page"] });
  }

  // Yello: {tenant}.yello.co/jobs/{opaque}. The URL token is a posting ID,
  // not an employer requisition; the page must supply the requisition.
  if (host.endsWith(".yello.co")) {
    const token = parts[0] === "jobs" && /^[A-Za-z0-9_-]{10,}$/.test(parts[1] ?? "") ? parts[1] : null;
    return identity({ ...base, system: "yello", tenantKey: host, requisitionId: token, detailPage: !!token,
      tenant: findTenant(host, null), notes: ["Yello URL token is an opaque posting ID; confirm the requisition on the page"] });
  }

  if (host.endsWith(".prismhr-hire.com")) {
    const id = parts[0] === "job" && /^\d{4,}$/.test(parts[1] ?? "") ? parts[1] : null;
    return identity({ ...base, system: "prismhr", tenantKey: host, requisitionId: id, detailPage: !!id,
      tenant: findTenant(host, null) });
  }

  if (host === "workforcenow.adp.com") {
    const cid = parsed.searchParams.get("cid")?.toLowerCase() ?? null;
    const jobId = parsed.searchParams.get("jobId");
    const id = jobId && /^\d{3,}$/.test(jobId) ? jobId : null;
    return identity({ ...base, system: "adp", tenantKey: cid ? `adp/${cid}` : null, requisitionId: id,
      detailPage: !!(cid && id), tenant: findTenant(host, cid),
      notes: ["ADP Workforce Now pages are client-rendered"] });
  }

  if (host === "www.zintellect.com" || host === "zintellect.com") {
    const code = parts[0]?.toLowerCase() === "opportunity" && parts[1]?.toLowerCase() === "details"
      && /^[A-Z]+(?:-[A-Z]+)*-\d{4}-\d{3,}$/i.test(parts[2] ?? "") ? parts[2].toUpperCase() : null;
    return identity({ ...base, system: "program", tenantKey: "www.zintellect.com", requisitionId: code,
      detailPage: !!code, tenant: findTenant("www.zintellect.com", null),
      notes: ["ORISE/Zintellect hosts appointments for many agencies; the sponsoring agency must come from the page"] });
  }

  // J&J careers: /{locale}/jobs/r-099389/{slug}/
  if (host === "www.careers.jnj.com" || host === "careers.jnj.com") {
    const index = parts.findIndex((part) => part.toLowerCase() === "jobs");
    const rawId = index >= 0 ? parts[index + 1] ?? "" : "";
    const id = /^r-\d{5,}$/i.test(rawId) ? rawId.toUpperCase() : null;
    return identity({ ...base, system: "jnj", tenantKey: "www.careers.jnj.com", requisitionId: id, detailPage: !!id,
      tenant: findTenant("www.careers.jnj.com", null) });
  }

  // Phenom-style sites: /{region}/{locale}/job/{ID}/{slug}
  const jobIndex = parts.findIndex((part) => ["job", "jobs", "jobdetails"].includes(part.toLowerCase()));
  const tenant = findTenant(host, null);
  if (tenant?.kind === "phenom" && jobIndex >= 0) {
    const rawId = parts[jobIndex + 1] ?? "";
    const id = /^[A-Z0-9][A-Z0-9-]{4,}$/i.test(rawId) && /\d{4,}/.test(rawId) ? rawId.toUpperCase() : null;
    return identity({ ...base, system: "phenom", tenantKey: host, requisitionId: id, detailPage: !!id, tenant });
  }

  // Radancy/TalentBrew: /{lang}/job/{city}/{slug}/{companyId}/{jobId}
  if (tenant?.kind === "radancy" && jobIndex >= 0) {
    const numeric = parts.slice(jobIndex + 1).filter((part) => /^\d{3,}$/.test(part));
    const companyId = numeric.length >= 2 ? numeric.at(-2) ?? null : null;
    const id = numeric.at(-1) ?? null;
    return identity({ ...base, system: "radancy", tenantKey: companyId ? `${host}/${companyId}` : host,
      requisitionId: id, detailPage: !!id, tenant });
  }

  // SuccessFactors / jobs2web: /job/{slug}/{numericId}/
  if (tenant?.kind === "successfactors" && jobIndex >= 0) {
    const id = [...parts].reverse().find((part) => /^\d{6,}$/.test(part)) ?? null;
    return identity({ ...base, system: "successfactors", tenantKey: host, requisitionId: id, detailPage: !!id, tenant });
  }

  // Generic employer site. Accept only a path with a recognisable individual
  // job identifier; a bare careers or search page is a listing.
  const candidates = parts.filter((part) => UUID.test(part)
    || /^(?:R|JR|REQ)[-_]?\d{4,}(?:-\d+)?$/i.test(part)
    || /^[A-F0-9]{24,}$/i.test(part)
    || /^\d{4,}$/.test(part));
  const id = candidates.at(-1) ?? null;
  const detail = !!id && (jobIndex >= 0 || parts.length >= 2) && !LISTING_SEGMENTS.has(lastSegment(parts).toLowerCase());
  return identity({ ...base, system: tenant ? (tenant.kind as PostingSystem) : "employer_site",
    tenantKey: host, requisitionId: id ? id.toUpperCase() : null, detailPage: detail, tenant,
    notes: tenant ? [] : ["Host is not in the tenant registry; employer ownership must come from page evidence"] });
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|incorporated|llc|ltd|corp|corporation|co|company|the|plc|sa|ag|gmbh)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameEmployerName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // "Gilead" vs "Gilead Sciences": the shorter name must be a whole-word prefix.
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 4 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
}

function textNames(text: string, name: string): boolean {
  const haystack = ` ${normalizeName(text)} `;
  const needle = normalizeName(name);
  return needle.length >= 3 && haystack.includes(` ${needle} `);
}

export type EmployerAttribution =
  | { status: "match"; reason: string }
  | { status: "operating_company_confirmed"; reason: string }
  | { status: "page_named"; reason: string }
  | { status: "needs_page_evidence"; reason: string }
  | { status: "mismatch"; reason: string }
  | { status: "unknown"; reason: string };

/**
 * Decide whether the URL's tenant belongs to the lead's employer. `pageText`
 * is fetched employer text, when available. A shared or parent tenant is
 * accepted only when the fetched page names the lead employer.
 */
export function attributeEmployer(input: {
  leadEmployer: string | null;
  identity: PostingIdentity;
  pageText?: string | null;
}): EmployerAttribution {
  const lead = input.leadEmployer?.trim() || null;
  const tenant = input.identity.tenant;
  const page = input.pageText ?? null;
  if (!lead) return { status: "unknown", reason: "The lead has no employer name to compare" };
  if (tenant) {
    const names = [tenant.employer, ...tenant.aliases];
    const direct = names.some((name) => sameEmployerName(name, lead));
    if (direct && !tenant.shared) {
      return { status: "match", reason: `${input.identity.tenantKey} belongs to ${tenant.employer}` };
    }
    const operating = tenant.operatingCompanies.some((name) => sameEmployerName(name, lead));
    if (operating || direct || tenant.shared) {
      if (page && textNames(page, lead)) {
        return {
          status: operating ? "operating_company_confirmed" : "page_named",
          reason: `${input.identity.tenantKey} is a ${tenant.shared ? "shared" : "parent"} tenant (${tenant.employer}); the page names ${lead}`,
        };
      }
      return {
        status: operating || tenant.shared ? "needs_page_evidence" : "match",
        reason: `${input.identity.tenantKey} is a ${tenant.shared ? "shared" : "parent"} tenant (${tenant.employer}); the page must name ${lead}`,
      };
    }
    return { status: "mismatch", reason: `${input.identity.tenantKey} belongs to ${tenant.employer}, not ${lead}` };
  }
  if (page && textNames(page, lead)) {
    return { status: "page_named", reason: `Tenant ${input.identity.tenantKey ?? input.identity.host} is unregistered; the page names ${lead}` };
  }
  return { status: "needs_page_evidence", reason: `Tenant ${input.identity.tenantKey ?? input.identity.host} is unregistered; employer ownership is unproven` };
}

/**
 * Candidate URLs that could be an individual employer posting. LinkedIn and
 * aggregators return false: they are discovery pointers only.
 */
export function isEmployerRequisitionUrl(identity: PostingIdentity): boolean {
  return identity.detailPage
    && identity.system !== "linkedin"
    && identity.system !== "aggregator"
    && identity.system !== "unknown"
    && !!identity.url?.startsWith("https://");
}
