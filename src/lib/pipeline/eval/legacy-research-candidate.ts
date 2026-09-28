/**
 * legacy-research-candidate.ts — FROZEN copy of PR #123's candidate URL rules
 * (710634e, source-research-discovery.ts). "Before" arm of the evaluation only.
 */
import { canonicalizeUrl, normalizeJobTitle } from "../../ingestion/normalize";
import { isRecognizedAtsHost } from "../ats-hosts";
import type { SearchProviderResult } from "../brave-search";

export function legacyExactRoleQueries(company: string, title: string, domain: string | null): string[] {
  const quotedCompany = company.replaceAll('"', '').slice(0, 100);
  const quotedTitle = title.replaceAll('"', '').slice(0, 140);
  return [
    `"${quotedCompany}" "${quotedTitle}" (intern OR co-op OR fellowship)`,
    `${domain ? `site:${domain} ` : ''}"${quotedTitle}" "${quotedCompany}"`,
  ];
}

function roleDetailPath(host: string, pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  if (/greenhouse\.io$/.test(host)) return /^\d{5,}$/.test(parts.at(-1) ?? '');
  if (host.endsWith('.myworkdayjobs.com')) return parts.includes('job') && /_[A-Z0-9]{5,}$/i.test(parts.at(-1) ?? '');
  if (host === 'jobs.ashbyhq.com' || host === 'jobs.lever.co' || host === 'jobs.jobvite.com') {
    return parts.length >= 2 && !['jobs', 'search', 'careers'].includes(parts.at(-1)!.toLowerCase());
  }
  return !['jobs', 'search', 'careers', 'job-search', 'openings'].includes(parts.at(-1)!.toLowerCase());
}

/** Stable identifiers used for conservative cross-locale duplicate checks. */
export function legacyPostingRequisitionId(rawUrl: string): string | null {
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) return null;
  const parsed = new URL(canonical);
  const path = parsed.pathname;
  if (/greenhouse\.io$/.test(parsed.hostname)) return path.match(/\/jobs\/(\d{5,})(?:\/|$)/)?.[1] ?? null;
  const workday = path.match(/_((?:R|JR)[-_]?\d{5,})(?:\/|$)/i);
  if (workday) return workday[1].toUpperCase();
  return path.match(/\b((?:R|JR)[-_]?\d{5,})\b/i)?.[1]?.toUpperCase() ?? null;
}

/** Conservative index triage, never an assertion that Apply is active. */
export function legacyResearchCandidateScore(input: {
  result: SearchProviderResult;
  company: string;
  title: string;
  careersDomain: string | null;
}): number {
  const url = canonicalizeUrl(input.result.url);
  if (!url) return 0;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return 0;
  const host = parsed.hostname.toLowerCase();
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 0;
  const allowedDomain = input.careersDomain && (host === input.careersDomain || host.endsWith(`.${input.careersDomain}`));
  if (!isRecognizedAtsHost(host) && !allowedDomain) return 0;
  // A board/search landing page is never an individual requisition.
  if (!roleDetailPath(host, parsed.pathname)) return 0;

  const roleTokens = new Set((normalizeJobTitle(input.title) ?? '').split(/[\s/]+/).filter((word) => word.length > 2));
  const resultTokens = new Set((normalizeJobTitle(input.result.title) ?? '').split(/[\s/]+/));
  if (roleTokens.size < 2 || [...roleTokens].filter((word) => resultTokens.has(word)).length / roleTokens.size < 0.8) return 0;
  const companyTokens = (normalizeJobTitle(input.company) ?? '').split(/[\s/]+/)
    .filter((word) => word.length >= 4 && !['bioworks', 'pharmaceuticals', 'therapeutics', 'technologies', 'corporation'].includes(word));
  const identityText = `${input.result.title ?? ''} ${input.result.snippet ?? ''} ${parsed.hostname} ${parsed.pathname}`.toLowerCase();
  if (companyTokens.length > 0 && !companyTokens.some((word) => identityText.includes(word))) return 0;
  return 80 + (allowedDomain ? 5 : 0) + Math.max(0, 10 - input.result.rank);
}

