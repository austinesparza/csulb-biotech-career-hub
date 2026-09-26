import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeUrl, normalizeJobTitle } from '../ingestion/normalize';
import { isRecognizedAtsHost } from './ats-hosts';
import type { SearchProvider, SearchProviderResult } from './brave-search';
import { archiveDiscoveryLead } from './lead-store-supabase';
import { buildHistoricalWatchPlans } from './historical-watch';
import { buildEmployerInventoryDiscoveryPlans } from './employer-inventory';
import { attributeEmployer, isEmployerRequisitionUrl, resolvePostingIdentity } from './posting-identity';
import { tenantHostsFor } from './query-families';

interface ResearchSubmission {
  id: string;
  payload: Record<string, unknown>;
}

export interface ResearchDiscoveryReport {
  searched: number;
  queries: number;
  results: number;
  archived: number;
  candidateLinks: number;
  existingMatches: number;
  errors: string[];
}

function value(payload: Record<string, unknown>, key: string): string {
  return typeof payload[key] === 'string' ? payload[key].trim() : '';
}

function exactRoleQueries(company: string, title: string, domain: string | null): string[] {
  const quotedCompany = company.replaceAll('"', '').slice(0, 100);
  const quotedTitle = title.replaceAll('"', '').slice(0, 140);
  // No parentheses: the provider documents OR but not grouping.
  return [
    `"${quotedCompany}" "${quotedTitle}" intern OR co-op OR fellowship`,
    `${domain ? `site:${domain} ` : ''}"${quotedTitle}" "${quotedCompany}"`,
  ];
}

function knownDomain(company: string, cycleYear: number, month: number): string | null {
  // A recruiting tenant (e.g. gilead.wd1.myworkdayjobs.com) finds requisitions;
  // a marketing domain (www.gilead.com) usually does not.
  const tenantHost = tenantHostsFor(company)[0];
  if (tenantHost) return tenantHost;
  const key = company.toLowerCase();
  const historical = buildHistoricalWatchPlans({ cycleYear, month })
    .find((entry) => entry.company.toLowerCase() === key)?.careersDomain;
  if (historical) return historical;
  return buildEmployerInventoryDiscoveryPlans({ cycleYear, limit: 50 })
    .find((entry) => entry.company.toLowerCase() === key)?.plan.careersDomain ?? null;
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
export function postingRequisitionId(rawUrl: string): string | null {
  const canonical = canonicalizeUrl(rawUrl);
  if (!canonical) return null;
  // Tenant-aware parsing handles Workday IDs such as 202608-121913,
  // REQ-30507-1 and R-2026-49482 that the earlier patterns missed.
  const identity = resolvePostingIdentity(canonical);
  if (identity.detailPage && identity.requisitionId && identity.system !== 'yello') return identity.requisitionId;
  const parsed = new URL(canonical);
  const path = parsed.pathname;
  if (/greenhouse\.io$/.test(parsed.hostname)) return path.match(/\/jobs\/(\d{5,})(?:\/|$)/)?.[1] ?? null;
  const workday = path.match(/_((?:R|JR)[-_]?\d{5,})(?:\/|$)/i);
  if (workday) return workday[1].toUpperCase();
  return path.match(/\b((?:R|JR)[-_]?\d{5,})\b/i)?.[1]?.toUpperCase() ?? null;
}

function sameRequisitionUrl(candidateUrl: string, existingUrl: string | null): boolean {
  if (!existingUrl) return false;
  const candidateKey = resolvePostingIdentity(candidateUrl).identityKey;
  if (candidateKey && candidateKey === resolvePostingIdentity(existingUrl).identityKey) return true;
  if (postingRequisitionId(candidateUrl) !== postingRequisitionId(existingUrl)) return false;
  const candidate = new URL(candidateUrl);
  const existing = new URL(existingUrl);
  if (/greenhouse\.io$/.test(candidate.hostname) && /greenhouse\.io$/.test(existing.hostname)) {
    return candidate.pathname.split('/').filter(Boolean)[0] === existing.pathname.split('/').filter(Boolean)[0];
  }
  return candidate.hostname === existing.hostname;
}

/** Conservative index triage, never an assertion that Apply is active. */
export function researchCandidateScore(input: {
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
  const identity = resolvePostingIdentity(url);
  // A registered tenant that belongs to another employer is never attached,
  // whatever the title says (e.g. an IBRI PrismHR page for a Libris lead).
  if (identity.tenant && attributeEmployer({ leadEmployer: input.company, identity }).status === 'mismatch') return 0;
  if (!isRecognizedAtsHost(host) && !allowedDomain && !identity.tenant) return 0;
  // A board/search landing page is never an individual requisition.
  const detail = isEmployerRequisitionUrl(identity)
    // Hosts without a tenant-aware parser (e.g. Jobvite) keep the path rule.
    || (identity.system === 'employer_site' && isRecognizedAtsHost(host) && roleDetailPath(host, parsed.pathname));
  if (!detail) return 0;

  const roleTokens = new Set((normalizeJobTitle(input.title) ?? '').split(/[\s/]+/).filter((word) => word.length > 2));
  const resultTokens = new Set((normalizeJobTitle(input.result.title) ?? '').split(/[\s/]+/));
  if (roleTokens.size < 2 || [...roleTokens].filter((word) => resultTokens.has(word)).length / roleTokens.size < 0.8) return 0;
  const companyTokens = (normalizeJobTitle(input.company) ?? '').split(/[\s/]+/)
    .filter((word) => word.length >= 4 && !['bioworks', 'pharmaceuticals', 'therapeutics', 'technologies', 'corporation'].includes(word));
  const identityText = `${input.result.title ?? ''} ${input.result.snippet ?? ''} ${parsed.hostname} ${parsed.pathname}`.toLowerCase();
  if (companyTokens.length > 0 && !companyTokens.some((word) => identityText.includes(word))) return 0;
  return 80 + (allowedDomain ? 5 : 0) + Math.max(0, 10 - input.result.rank);
}

function dailyCohort<T>(rows: T[], date: Date, limit: number): T[] {
  if (!rows.length) return [];
  const offset = Math.floor(date.valueOf() / 86_400_000) * limit;
  return Array.from({ length: Math.min(rows.length, limit) }, (_, i) => rows[(offset + i) % rows.length]);
}

/**
 * Search exact roles left in source research, archive index observations, and
 * attach only a distinct candidate URL to the existing private submission.
 * This worker cannot approve, publish, or claim that a posting is open.
 */
export async function runSourceResearchDiscoveryBatch(params: {
  db: SupabaseClient;
  provider: SearchProvider;
  now?: Date;
  limit?: number;
  resultsPerQuery?: number;
  runId?: string;
}): Promise<ResearchDiscoveryReport> {
  const now = params.now ?? new Date();
  const limit = params.limit ?? 3;
  const resultsPerQuery = params.resultsPerQuery ?? 5;
  if (Number.isNaN(now.valueOf()) || !Number.isInteger(limit) || limit < 1 || limit > 5
    || !Number.isInteger(resultsPerQuery) || resultsPerQuery < 1 || resultsPerQuery > 10) {
    throw new Error('invalid source research discovery bounds');
  }
  const { data, error } = await params.db.from('user_submissions').select('id,payload')
    .eq('status', 'new').eq('payload->>intake_stage', 'source_research').order('created_at', { ascending: true }).limit(250);
  if (error) throw new Error(`load private source research: ${error.message}`);
  const rows = (data ?? []) as ResearchSubmission[];
  const unresolved = rows.filter((row) => !value(row.payload, 'candidate_employer_url')
    && value(row.payload, 'company') && value(row.payload, 'title'));
  const cohort = dailyCohort(unresolved, now, limit);
  const report: ResearchDiscoveryReport = {
    searched: cohort.length, queries: 0, results: 0, archived: 0, candidateLinks: 0, existingMatches: 0, errors: [],
  };
  const cycleYear = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const runId = params.runId ?? `source-research:${now.toISOString().slice(0, 10)}`;
  const candidateUrls = new Set(rows.map((row) => canonicalizeUrl(value(row.payload, 'candidate_employer_url'))).filter(Boolean));

  for (const row of cohort) {
    const company = value(row.payload, 'company');
    const title = value(row.payload, 'title');
    const domain = knownDomain(company, cycleYear, now.getUTCMonth() + 1);
    const observations: Array<{ result: SearchProviderResult; query: string; url: string; score: number }> = [];
    for (const query of exactRoleQueries(company, title, domain)) {
      report.queries++;
      try {
        for (const result of await params.provider.search(query, resultsPerQuery)) {
          report.results++;
          const url = canonicalizeUrl(result.url);
          if (!url) continue;
          observations.push({ result, query, url, score: researchCandidateScore({ result, company, title, careersDomain: domain }) });
        }
      } catch (searchError) {
        report.errors.push(`${row.id}: ${String(searchError).slice(0, 300)}`);
      }
    }
    const best = observations.filter((item) => item.score > 0)
      .toSorted((a, b) => b.score - a.score || a.url.localeCompare(b.url))[0];
    let existingOpportunityId: string | null = null;
    let existingPostingId: string | null = null;
    let alreadyResearchCandidate = false;
    let linked = false;
    if (best) {
      const reqId = postingRequisitionId(best.url);
      const [opportunities, postings, postingIds, opportunityIds] = await Promise.all([
        params.db.from('opportunities').select('id,posting_url').in('posting_url', [best.url, `${best.url}/`]).limit(5),
        params.db.from('source_postings').select('id,canonical_url').in('canonical_url', [best.url, `${best.url}/`]).limit(5),
        reqId ? params.db.from('source_postings').select('id,canonical_url,external_posting_id').eq('external_posting_id', reqId).limit(10) : Promise.resolve({ data: [], error: null }),
        reqId ? params.db.from('opportunities').select('id,posting_url').ilike('posting_url', `%${reqId}%`).limit(20) : Promise.resolve({ data: [], error: null }),
      ]);
      const checkError = opportunities.error ?? postings.error ?? postingIds.error ?? opportunityIds.error;
      if (checkError) {
        report.errors.push(`${row.id}: duplicate check failed: ${checkError.message}`);
      } else {
        const sameRequisition = (other: string | null) => sameRequisitionUrl(best.url, other);
        existingOpportunityId = opportunities.data?.[0]?.id
          ?? opportunityIds.data?.find((candidate) => sameRequisition(candidate.posting_url))?.id ?? null;
        existingPostingId = postings.data?.[0]?.id
          ?? postingIds.data?.find((candidate) => sameRequisition(candidate.canonical_url))?.id ?? null;
        alreadyResearchCandidate = candidateUrls.has(best.url);
        if (existingOpportunityId || existingPostingId || alreadyResearchCandidate) report.existingMatches++;
        const nextPayload = {
          ...row.payload,
          candidate_employer_url: best.url,
          role_url_status: existingOpportunityId || existingPostingId ? 'existing_record_match' : 'indexed_employer_url_unrendered',
          ...(existingOpportunityId ? { existing_opportunity_id: existingOpportunityId } : {}),
          ...(existingPostingId ? { existing_source_posting_id: existingPostingId } : {}),
          posting_status: 'unknown',
          msc_eligibility: 'unknown',
          search_candidate_checked_at: now.toISOString(),
        };
        // Optimistic compare protects an officer's concurrent edits to JSON.
        const updated = await params.db.from('user_submissions').update({ payload: nextPayload })
          .eq('id', row.id).eq('status', 'new').eq('payload', JSON.stringify(row.payload)).select('id');
        if (updated.error) report.errors.push(`${row.id}: save candidate: ${updated.error.message}`);
        else if (updated.data?.length === 1) {
          report.candidateLinks++;
          candidateUrls.add(best.url);
          linked = true;
        }
        else report.errors.push(`${row.id}: research record changed during search; left unchanged`);
      }
    }

    for (const item of observations) {
      const hostname = new URL(item.url).hostname;
      const route = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')
        ? 'linkedin_lead' : isRecognizedAtsHost(hostname) ? 'official_feed' : 'web_search';
      const selected = !!best && item.url === best.url;
      try {
        await archiveDiscoveryLead(params.db, {
          runId, route, query: item.query, lane: null, originalUrl: item.url, normalizedUrl: item.url,
          visibleTitle: item.result.title, visibleSnippet: item.result.snippet, employerHint: company,
          originalReachable: false, resolution: route === 'linkedin_lead' ? 'linkedin_only' : 'unresolved',
          canonicalEmployerUrl: null,
          archiveReason: 'Search-index lead. Verify the individual employer posting, Apply state and eligibility before review.',
          rawMetadata: {
            provider: params.provider.name, rank: item.result.rank, researchSubmissionId: row.id,
            evidenceLevel: 'search_index_only', matchScore: item.score,
            indexedEmployerUrl: item.score > 0 ? item.url : null,
            reviewCandidate: selected && linked
              && !existingOpportunityId && !existingPostingId && !alreadyResearchCandidate,
          },
          retrievedAt: now.toISOString(),
        });
        report.archived++;
      } catch (archiveError) {
        report.errors.push(`${row.id}: archive: ${String(archiveError).slice(0, 300)}`);
      }
    }
  }
  return report;
}
