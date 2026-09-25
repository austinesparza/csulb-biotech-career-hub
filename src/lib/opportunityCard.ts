import type { PublicOpportunity } from './types';

const SHORT_TAGS: Record<string, string> = {
  'Cancer and oncology': 'Oncology',
  'Genomics and genetics': 'Genomics',
  'Single-cell and spatial': 'Single-cell & spatial',
  'Bioinformatics and computational biology': 'Bioinformatics',
  'Biological data science and ML': 'Data science & ML',
  'Diagnostics and clinical data': 'Diagnostics',
  'Bioprocess and manufacturing science': 'Bioprocess',
  'Protein science and drug discovery': 'Drug discovery',
  'Neuroscience and neurodegeneration': 'Neuroscience',
  'Immunology and infectious disease': 'Immunology',
  'Process, manufacturing and quality': 'Manufacturing & quality',
  'Computational and analysis': 'Computation & analysis',
  'Technical product and program': 'Technical programs',
  'Research and discovery': 'R&D',
  'python': 'Python',
  'sql': 'SQL',
};

const LEGACY_FOCUS_TAGS: Array<[RegExp, string]> = [
  [/translational cancer|medical oncology|cancer research|biomarker/i, 'Oncology'],
  [/bioinformatics.*data science|biomedical data science/i, 'Bioinformatics'],
  [/bioprocess|process development/i, 'Bioprocess'],
  [/laboratory automation|autonomous lab/i, 'Lab automation'],
  [/medtech.*r&d|medtech.*engineering/i, 'MedTech R&D'],
  [/engineering.*automation|data.*automation/i, 'Engineering & automation'],
  [/operations.*manufactur/i, 'Operations & manufacturing'],
  [/data.*digital.*technology/i, 'Data & technology'],
];

const GENERIC_COMPANY_TAG = /^(?:biotechnology|biotech|healthcare|biopharma|pharmaceuticals?|life sciences?)$/i;
const ATS_HOST = /(?:^|\.)(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|ashbyhq\.com)$/i;

function compactTag(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (SHORT_TAGS[trimmed]) return SHORT_TAGS[trimmed];
  const legacy = LEGACY_FOCUS_TAGS.find(([pattern]) => pattern.test(trimmed));
  return legacy?.[1] ?? trimmed;
}

/**
 * Prefer controlled scientific lanes, then concrete methods, then job functions.
 * Legacy focus-area prose is only used when no controlled lane is available.
 */
export function opportunityTags(opportunity: PublicOpportunity): string[] {
  const lanes = (opportunity.scientific_lanes ?? []).filter((value) => value.trim());
  const candidates = lanes.length > 0
    ? [...lanes, ...(opportunity.methods ?? []), ...(opportunity.job_functions ?? [])]
    : [opportunity.focus_area ?? '', ...(opportunity.methods ?? []), ...(opportunity.job_functions ?? [])];
  const seen = new Set<string>();

  return candidates
    .map(compactTag)
    .filter((tag) => {
      const normalized = tag.toLowerCase();
      if (!normalized || /^(?:(?:bio)?tech(?:nology)?|pharma(?:ceuticals?)?|life sciences?)$/.test(normalized)) return false;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 3);
}

/** Keep the main card line about what the organization does, not where its HQ is. */
export function companyContextLine(opportunity: PublicOpportunity): string | null {
  const industry = (opportunity.company_industry_tags ?? [])
    .map((tag) => tag.trim())
    .find((tag) => tag && !GENERIC_COMPANY_TAG.test(tag));
  return industry || null;
}

/** Similar titles can be separate employer requisitions with different gates. */
export function relatedPostingIds(opportunities: PublicOpportunity[]): Set<string> {
  const groups = new Map<string, PublicOpportunity[]>();
  for (const opportunity of opportunities) {
    if (!opportunity.posting_url || !opportunity.location) continue;
    const title = opportunity.title.toLowerCase()
      .replace(/\b(?:grad|graduate)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    if (!title) continue;
    const key = `${opportunity.company_name.toLowerCase().trim()}|${opportunity.location.toLowerCase().trim()}|${title}`;
    groups.set(key, [...(groups.get(key) ?? []), opportunity]);
  }
  const ids = new Set<string>();
  for (const group of groups.values()) {
    if (new Set(group.map((opportunity) => opportunity.posting_url)).size < 2) continue;
    for (const opportunity of group) ids.add(opportunity.id);
  }
  return ids;
}

function hostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function baseDomain(host: string): string {
  const parts = host.split('.').filter(Boolean);
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

function isEmployerOwnedPosting(opportunity: PublicOpportunity): boolean {
  const postingHost = hostname(opportunity.posting_url);
  const companyHost = hostname(opportunity.company_website);
  return Boolean(postingHost && companyHost && baseDomain(postingHost) === baseDomain(companyHost));
}

function isLinkedInPosting(opportunity: PublicOpportunity): boolean {
  const postingHost = hostname(opportunity.posting_url);
  return Boolean(postingHost && /(?:^|\.)linkedin\.com$/i.test(postingHost));
}

function isEmployerAtsPosting(opportunity: PublicOpportunity): boolean {
  const postingHost = hostname(opportunity.posting_url);
  return Boolean(postingHost && ATS_HOST.test(postingHost));
}

export function postingLinkLabel(opportunity: PublicOpportunity): string {
  if (isLinkedInPosting(opportunity)) return 'View LinkedIn posting ↗';
  if (isEmployerOwnedPosting(opportunity) || isEmployerAtsPosting(opportunity)) return 'Official posting ↗';
  return 'View posting ↗';
}

export function sourceEvidenceLabel(opportunity: PublicOpportunity): string {
  if (opportunity.source_name) {
    const employerFeed = opportunity.source_name.match(/^(.*?)\s+careers board$/i);
    return employerFeed
      ? `Official employer feed: ${employerFeed[1]}`
      : `Source: ${opportunity.source_name}`;
  }
  if (isLinkedInPosting(opportunity)) return 'LinkedIn job posting';
  if (isEmployerOwnedPosting(opportunity) || isEmployerAtsPosting(opportunity)) return 'Employer application page';
  if (opportunity.posting_url) return 'Public job posting';
  return 'Officer-reviewed source';
}

export function noteLabel(note: string): string {
  return /\b(compensation|pay|salary|hour|month|stipend|wage)\b/i.test(note)
    ? 'Compensation'
    : 'Context';
}

export function timingFallbackLabel(value: string | null): string {
  const text = value?.trim();
  if (!text) return 'No deadline stated';
  if (/^unknown$/i.test(text)) return 'No deadline stated';
  if (/^unknown\s*;/i.test(text)) return text.replace(/^unknown/i, 'No deadline stated');
  if (/^(?:not stated or )?rolling$/i.test(text)) return 'Rolling / no fixed deadline stated';
  if (/^not stated$/i.test(text)) return 'No deadline stated';
  return text;
}

/** Keep server and browser rendering identical even when their local timezones differ. */
export function formatOpportunityDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
