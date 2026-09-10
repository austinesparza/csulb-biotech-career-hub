/**
 * index.ts — connectors for the official job-board APIs.
 *
 * Every `parse` is pure and takes a response body, so connectors are unit
 * testable against fixtures with no network. The fetch itself lives in the
 * worker, which handles conditional GET, rate limiting and SSRF guards.
 *
 * VERIFY THE URL SHAPES AGAINST CURRENT VENDOR DOCS BEFORE FIRST RUN. These
 * paths have been stable for years, but a 404 at 3am is a bad time to find out
 * a vendor moved something.
 */
import type { Connector, CanonicalPosting, ConnectorResult } from "./types";
import { toRawText } from "./types";

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const uniqueStrings = (values: unknown[]): string[] =>
  [...new Set(values.map(str).map((value) => value.trim()).filter(Boolean))];
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Guard every parser: a vendor returning HTML during an outage must not throw. */
function parseJson(body: string, kind: string): { data: unknown; warnings: string[] } {
  try {
    return { data: JSON.parse(body), warnings: [] };
  } catch {
    return { data: null, warnings: [`${kind}: response was not JSON (vendor outage or changed endpoint?)`] };
  }
}

// ---------------------------------------------------------------------------
// Greenhouse — boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
// ---------------------------------------------------------------------------
export const greenhouse: Connector = {
  kind: "greenhouse",
  listUrl: (identifier) =>
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(identifier)}/jobs?content=true`,
  parse(body, ctx): ConnectorResult {
    const { data, warnings } = parseJson(body, "greenhouse");
    const jobs = (data as { jobs?: unknown[] })?.jobs;
    if (!Array.isArray(jobs)) return { postings: [], warnings: [...warnings, "greenhouse: no `jobs` array"] };
    const postings = jobs.map((job): CanonicalPosting => {
      const j = job as Record<string, any>;
      const departments = (j.departments ?? []).map((d: any) => str(d?.name)).filter(Boolean);
      const offices = (j.offices ?? []).map((o: any) => str(o?.name)).filter(Boolean);
      return {
        sourceKind: "greenhouse",
        employer: ctx.employer,
        externalId: str(j.id),
        title: str(j.title),
        url: str(j.absolute_url),
        location: str(j.location?.name) || offices.join("; "),
        // `content` is HTML-escaped markup; toRawText decodes and flattens it.
        rawText: toRawText([j.title, departments.join(", "), j.content]),
        postedAt: iso(j.first_published ?? j.updated_at),
        updatedAt: iso(j.updated_at),
        extra: { departments, offices, requisitionId: j.requisition_id ?? null },
      };
    });
    return { postings, warnings };
  },
};

// ---------------------------------------------------------------------------
// Ashby — api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
// ---------------------------------------------------------------------------
export const ashby: Connector = {
  kind: "ashby",
  listUrl: (identifier) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(identifier)}?includeCompensation=true`,
  parse(body, ctx): ConnectorResult {
    const { data, warnings } = parseJson(body, "ashby");
    const jobs = (data as { jobs?: unknown[] })?.jobs;
    if (!Array.isArray(jobs)) return { postings: [], warnings: [...warnings, "ashby: no `jobs` array"] };
    const postings = jobs.flatMap((job, index): CanonicalPosting[] => {
      const j = job as Record<string, any>;
      if (j.isListed === false) {
        warnings.push(`ashby: skipped unlisted job at index ${index}`);
        return [];
      }
      const title = str(j.title).trim();
      const url = str(j.jobUrl ?? j.applyUrl).trim();
      if (!title || !url) {
        warnings.push(`ashby: skipped job at index ${index} without a title or stable URL`);
        return [];
      }
      const secondaryLocations = Array.isArray(j.secondaryLocations)
        ? j.secondaryLocations.map((location: any) => location?.location)
        : [];
      const locations = uniqueStrings([j.location, ...secondaryLocations]);
      // Ashby exposes compensation separately -- one of the few sources that
      // hands you pay range as structured data instead of buried prose.
      const comp = j.compensation?.compensationTierSummary ?? j.compensationTierSummary ?? null;
      return [{
        sourceKind: "ashby",
        employer: ctx.employer,
        // Ashby's public posting schema does not expose a job ID. jobUrl is
        // the stable public identity supplied by the API.
        externalId: url,
        title,
        url,
        location: locations.join("; "),
        rawText: toRawText([
          title,
          j.department,
          locations.length ? `Locations: ${locations.join("; ")}` : null,
          j.workplaceType ? `Workplace type: ${str(j.workplaceType)}` : null,
          j.descriptionHtml ?? j.descriptionPlain,
          comp ? `Compensation: ${comp}` : null,
        ]),
        postedAt: iso(j.publishedAt),
        updatedAt: iso(j.publishedAt),
        extra: {
          team: j.team ?? null,
          employmentType: j.employmentType ?? null,
          isRemote: j.isRemote ?? null,
          workplaceType: j.workplaceType ?? null,
          secondaryLocations,
          compensationSummary: comp,
        },
      }];
    });
    return { postings, warnings };
  },
};

// ---------------------------------------------------------------------------
// Lever — api.lever.co/v0/postings/{company}?mode=json
// ---------------------------------------------------------------------------
export const lever: Connector = {
  kind: "lever",
  listUrl: (identifier) => `https://api.lever.co/v0/postings/${encodeURIComponent(identifier)}?mode=json`,
  parse(body, ctx): ConnectorResult {
    const { data, warnings } = parseJson(body, "lever");
    if (!Array.isArray(data)) return { postings: [], warnings: [...warnings, "lever: expected a top-level array"] };
    const postings = (data as Record<string, any>[]).map((j): CanonicalPosting => {
      const lists = (j.lists ?? []).map((l: any) => `${str(l?.text)}\n${str(l?.content)}`);
      const locations = uniqueStrings([
        j.categories?.location,
        ...(Array.isArray(j.categories?.allLocations) ? j.categories.allLocations : []),
      ]);
      const salaryRange = j.salaryRange && typeof j.salaryRange === "object"
        ? [j.salaryRange.min, j.salaryRange.max, j.salaryRange.currency, j.salaryRange.interval]
            .filter((value) => value !== null && value !== undefined && value !== "")
            .map(str)
            .join(" ")
        : "";
      const salary = str(j.salaryDescriptionPlain ?? j.salaryDescription) || salaryRange;
      return {
        sourceKind: "lever",
        employer: ctx.employer,
        externalId: str(j.id),
        title: str(j.text),
        url: str(j.hostedUrl ?? j.applyUrl),
        location: locations.join("; "),
        rawText: toRawText([
          j.text,
          locations.length ? `Locations: ${locations.join("; ")}` : null,
          j.workplaceType ? `Workplace type: ${str(j.workplaceType)}` : null,
          j.descriptionPlain ?? j.description,
          ...lists,
          j.additionalPlain ?? j.additional,
          salary ? `Compensation: ${salary}` : null,
        ]),
        postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
        updatedAt: j.updatedAt ? new Date(Number(j.updatedAt)).toISOString() : null,
        extra: {
          team: j.categories?.team ?? null,
          commitment: j.categories?.commitment ?? null,
          workplaceType: j.workplaceType ?? null,
          allLocations: locations,
          salaryRange: j.salaryRange ?? null,
          salaryDescription: salary || null,
        },
      };
    });
    return { postings, warnings };
  },
};

// ---------------------------------------------------------------------------
// USAJOBS — data.usajobs.gov/api/search
// Requires an API key AND a User-Agent set to your registered email.
// Covers NIH, NCI and other federal programs, which is a real slice of the board.
// ---------------------------------------------------------------------------
export const usajobs: Connector = {
  kind: "usajobs",
  // identifier is JSON, not a raw query string: building the query with
  // URLSearchParams keeps a stray value from injecting extra parameters.
  listUrl: (identifier) => {
    let params: Record<string, string>;
    try {
      params = JSON.parse(identifier);
    } catch {
      throw new Error("usajobs identifier must be a JSON object of query parameters");
    }
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    return `https://data.usajobs.gov/api/search?${query.toString()}`;
  },
  parse(body, ctx): ConnectorResult {
    const { data, warnings } = parseJson(body, "usajobs");
    const items = (data as any)?.SearchResult?.SearchResultItems;
    if (!Array.isArray(items)) return { postings: [], warnings: [...warnings, "usajobs: no SearchResultItems"] };
    const postings = items.map((item: any): CanonicalPosting => {
      const d = item?.MatchedObjectDescriptor ?? {};
      const uds = d.UserArea?.Details ?? {};
      const pay = (d.PositionRemuneration ?? [])
        .map((p: any) => `${str(p.MinimumRange)}-${str(p.MaximumRange)} ${str(p.RateIntervalCode)}`)
        .join("; ");
      return {
        sourceKind: "usajobs",
        employer: str(d.OrganizationName) || ctx.employer,
        externalId: str(item?.MatchedObjectId ?? d.PositionID),
        title: str(d.PositionTitle),
        url: str(d.PositionURI),
        location: (d.PositionLocation ?? []).map((l: any) => str(l.LocationName)).join("; "),
        rawText: toRawText([
          d.PositionTitle, d.QualificationSummary, uds.JobSummary,
          uds.MajorDuties ? [].concat(uds.MajorDuties).join("\n") : null,
          uds.Education, uds.Requirements, uds.WhoMayApply?.Name,
          pay ? `Pay: ${pay}` : null,
        ]),
        postedAt: iso(d.PublicationStartDate),
        updatedAt: iso(d.PublicationStartDate),
        extra: {
          closeDate: d.ApplicationCloseDate ?? null,
          gradeRange: `${str(d.JobGrade?.[0]?.Code)}`,
          whoMayApply: uds.WhoMayApply?.Name ?? null,
          payRange: pay || null,
        },
      };
    });
    return { postings, warnings };
  },
};

// ---------------------------------------------------------------------------
// Plain page — institutional program pages with no ATS.
// Change detection does the work; this just makes one document.
// ---------------------------------------------------------------------------
export const page: Connector = {
  kind: "page",
  listUrl: (identifier) => identifier,
  parse(body, ctx): ConnectorResult {
    const text = toRawText([body]);
    if (text.length < 200) {
      return { postings: [], warnings: [`page: ${ctx.identifier} produced only ${text.length} chars of text (JS-rendered page?)`] };
    }
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const h1Match = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return {
      postings: [{
        sourceKind: "page",
        employer: ctx.employer,
        externalId: ctx.identifier,
        title: toRawText([h1Match?.[1] ?? titleMatch?.[1] ?? ctx.employer]).slice(0, 300),
        url: ctx.identifier,
        location: "",
        rawText: text,
        postedAt: null,
        updatedAt: null,
        extra: {},
      }],
      warnings: [],
    };
  },
};

export const CONNECTORS: Record<string, Connector> = {
  greenhouse, ashby, lever, usajobs, page,
};

export function getConnector(kind: string): Connector {
  const connector = CONNECTORS[kind];
  if (!connector) throw new Error(`unknown connector kind: ${kind}`);
  return connector;
}
