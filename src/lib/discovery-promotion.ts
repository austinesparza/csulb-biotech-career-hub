export interface DiscoveryPromotionInput {
  resolution: string;
  canonicalEmployerUrl: string | null;
  employerHint: string | null;
  title: string | null;
}

export type DiscoveryPromotionResolution =
  | { ready: true; canonicalUrl: string; employer: string; title: string }
  | { ready: false; reason: string };

export type EmployerSourceUrlResolution =
  | { valid: true; canonicalUrl: string }
  | { valid: false; reason: string };

const DISCOVERY_ONLY_HOSTS = [
  'linkedin.com',
  'lnkd.in',
  'indeed.com',
  'glassdoor.com',
  'monster.com',
  'ziprecruiter.com',
  'simplyhired.com',
  'talent.com',
  'jobleads.com',
  'tallo.com',
  'internships.com',
  'builtin.com',
  'handshake.com',
  'joinhandshake.com',
] as const;

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, blocked: string): boolean {
  return hostname === blocked || hostname.endsWith(`.${blocked}`);
}

/**
 * Validate a URL supplied by an officer as employer-controlled publication
 * evidence. Known social, aggregator, and discovery-only hosts are rejected.
 * The officer must still attest that an allowed URL belongs to the employer or
 * its recruiting/ATS provider because hostname allowlists cannot prove that.
 */
export function validateEmployerControlledSourceUrl(value: string): EmployerSourceUrlResolution {
  const canonicalUrl = safeHttpsUrl(value.trim());
  if (!canonicalUrl) {
    return { valid: false, reason: 'Enter a valid HTTPS employer or recruiting-system URL' };
  }

  const hostname = new URL(canonicalUrl).hostname.toLowerCase().replace(/^www\./, '');
  const blocked = DISCOVERY_ONLY_HOSTS.find((domain) => hostMatches(hostname, domain));
  if (blocked) {
    return {
      valid: false,
      reason: 'LinkedIn and job aggregators are discovery evidence only. Use the employer career site or its ATS posting.',
    };
  }

  return { valid: true, canonicalUrl };
}

/**
 * Discovery leads may become private opportunity drafts only after provenance
 * resolution reaches an employer-controlled HTTPS source. This helper never
 * grants publication authority.
 */
export function resolveDiscoveryPromotion(input: DiscoveryPromotionInput): DiscoveryPromotionResolution {
  if (input.resolution !== 'official_source_found') {
    return { ready: false, reason: 'An employer-controlled source has not been resolved yet' };
  }

  const canonicalUrl = safeHttpsUrl(input.canonicalEmployerUrl);
  if (!canonicalUrl) {
    return { ready: false, reason: 'A valid employer-controlled HTTPS URL is required' };
  }

  const employer = input.employerHint?.trim() ?? '';
  if (!employer) return { ready: false, reason: 'Employer name is missing' };

  const title = input.title?.trim() ?? '';
  if (!title) return { ready: false, reason: 'Role title is missing' };

  return { ready: true, canonicalUrl, employer, title };
}
