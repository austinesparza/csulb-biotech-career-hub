export interface DiscoveryPromotionInput {
  resolution: string;
  canonicalEmployerUrl: string | null;
  employerHint: string | null;
  title: string | null;
}

export type DiscoveryPromotionResolution =
  | { ready: true; canonicalUrl: string; employer: string; title: string }
  | { ready: false; reason: string };

function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
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
