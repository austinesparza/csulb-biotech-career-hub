export type InferableBoardKind = 'greenhouse' | 'ashby' | 'lever';

const BOARD_SLUG = /^[A-Za-z0-9_-]+$/;

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
}

function safeSlug(value: string | undefined): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).trim();
  return BOARD_SLUG.test(decoded) ? decoded : null;
}

export function inferSourceIdentifier(sourceKind: string, careersUrl: string): string | null {
  if (!['greenhouse', 'ashby', 'lever'].includes(sourceKind)) return null;

  let url: URL;
  try {
    url = new URL(careersUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  const segments = pathSegments(url);

  if (sourceKind === 'greenhouse') {
    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
      return safeSlug(segments[0]);
    }
    if (host === 'boards-api.greenhouse.io') {
      const boardIndex = segments.findIndex((segment) => segment === 'boards');
      return safeSlug(boardIndex >= 0 ? segments[boardIndex + 1] : undefined);
    }
    return null;
  }

  if (sourceKind === 'lever') {
    if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
      return safeSlug(segments[0]);
    }
    if (host === 'api.lever.co') {
      const postingsIndex = segments.findIndex((segment) => segment === 'postings');
      return safeSlug(postingsIndex >= 0 ? segments[postingsIndex + 1] : undefined);
    }
    return null;
  }

  if (host === 'jobs.ashbyhq.com') {
    return safeSlug(segments[0]);
  }
  if (host === 'api.ashbyhq.com') {
    const boardIndex = segments.findIndex((segment) => segment === 'job-board');
    return safeSlug(boardIndex >= 0 ? segments[boardIndex + 1] : undefined);
  }
  return null;
}

export function resolveSourceIdentifier(params: {
  sourceKind: string;
  explicitIdentifier: string | null;
  careersUrl: string;
}): string | null {
  const explicit = params.explicitIdentifier?.trim() || null;
  if (explicit) {
    if (['greenhouse', 'ashby', 'lever'].includes(params.sourceKind) && /^https:\/\//i.test(explicit)) {
      return inferSourceIdentifier(params.sourceKind, explicit);
    }
    return explicit;
  }
  return inferSourceIdentifier(params.sourceKind, params.careersUrl);
}
