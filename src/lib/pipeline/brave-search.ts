const BRAVE_WEB_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const MAX_QUERY_LENGTH = 2_000;
const MAX_RESULTS = 10;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface SearchProviderResult {
  url: string;
  title: string | null;
  snippet: string | null;
  rank: number;
}

export interface SearchProvider {
  name: string;
  search(query: string, count?: number): Promise<SearchProviderResult[]>;
}

function singleLine(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) throw new Error(`${label} must be a non-empty single line`);
  return trimmed;
}

function plainText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return text || null;
}

/**
 * Brave explicitly requires a plan with storage rights before results may be
 * retained. The archive client therefore refuses to run without a separate,
 * server-only confirmation flag in addition to the API key.
 */
export function createBraveSearchProvider(options: {
  apiKey: string;
  storageRightsConfirmed: boolean;
  fetchImpl?: typeof fetch;
}): SearchProvider {
  const apiKey = singleLine(options.apiKey, 'Brave Search API key');
  if (!options.storageRightsConfirmed) {
    throw new Error('Brave Search result storage rights have not been confirmed for this subscription');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: 'brave',
    async search(query: string, count = 5): Promise<SearchProviderResult[]> {
      const cleaned = singleLine(query, 'Search query');
      if (cleaned.length > MAX_QUERY_LENGTH) throw new Error(`Search query exceeds ${MAX_QUERY_LENGTH} characters`);
      if (!Number.isInteger(count) || count < 1 || count > MAX_RESULTS) {
        throw new Error(`Search result count must be from 1 to ${MAX_RESULTS}`);
      }
      const url = new URL(BRAVE_WEB_ENDPOINT);
      url.searchParams.set('q', cleaned);
      url.searchParams.set('count', String(count));
      url.searchParams.set('country', 'us');
      url.searchParams.set('search_lang', 'en');
      const response = await fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Brave Search API failed (${response.status})`);
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_RESPONSE_BYTES) throw new Error('Brave Search API response exceeded the size limit');
      const bodyText = await response.text();
      if (Buffer.byteLength(bodyText) > MAX_RESPONSE_BYTES) {
        throw new Error('Brave Search API response exceeded the size limit');
      }
      let body: { web?: { results?: unknown[] } };
      try {
        body = JSON.parse(bodyText) as typeof body;
      } catch {
        throw new Error('Brave Search API returned invalid JSON');
      }
      const results = body.web?.results;
      if (!Array.isArray(results)) return [];
      return results.slice(0, count).flatMap((item, index) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        if (typeof row.url !== 'string' || !row.url.trim()) return [];
        return [{
          url: row.url.trim(),
          title: plainText(row.title, 500),
          snippet: plainText(row.description, 2_000),
          rank: index + 1,
        }];
      });
    },
  };
}
