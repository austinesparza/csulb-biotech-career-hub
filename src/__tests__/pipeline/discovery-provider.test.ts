import { describe, expect, it } from 'vitest';
import { createBraveSearchProvider } from '../../lib/pipeline/brave-search';
import { runEmployerDiscoveryBatch } from '../../lib/pipeline/discovery-runner';
import { archiveDiscoveryLead, type DiscoveryLeadObservation } from '../../lib/pipeline/lead-store-supabase';

describe('governed search-provider discovery', () => {
  it('requires explicit result-storage rights in addition to an API key', () => {
    expect(() => createBraveSearchProvider({ apiKey: 'fixture-key', storageRightsConfirmed: false }))
      .toThrow('storage rights');
  });

  it('calls only the fixed Brave endpoint and bounds archived result fields', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      calledUrl = String(input);
      calledInit = init;
      return new Response(JSON.stringify({
        web: { results: [{
          url: 'https://jobs.ashbyhq.com/example/123',
          title: '<strong>Genomics</strong> Intern',
          description: '<p>Graduate internship</p>',
        }] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const provider = createBraveSearchProvider({
      apiKey: 'fixture-key', storageRightsConfirmed: true, fetchImpl,
    });
    await expect(provider.search('"Example Bio" internship', 5)).resolves.toEqual([{
      url: 'https://jobs.ashbyhq.com/example/123',
      title: 'Genomics Intern',
      snippet: 'Graduate internship',
      rank: 1,
    }]);
    expect(calledUrl).toMatch(/^https:\/\/api\.search\.brave\.com\/res\/v1\/web\/search\?/);
    expect((calledInit?.headers as Record<string, string>)['X-Subscription-Token']).toBe('fixture-key');
    expect(calledInit?.redirect).toBe('error');
  });

  it('archives every returned result as a private lead without publishing', async () => {
    const rpcCalls: Array<Record<string, unknown>> = [];
    const db = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe('archive_discovery_lead');
        rpcCalls.push(args);
        return { data: `lead-${rpcCalls.length}`, error: null };
      },
    };
    const provider = {
      name: 'fixture-search',
      async search(query: string) {
        return [{
          url: query.includes('linkedin.com')
            ? 'https://www.linkedin.com/jobs/view/123'
            : 'https://jobs.ashbyhq.com/example/123',
          title: 'Graduate Genomics Intern', snippet: 'A public search snippet', rank: 1,
        }];
      },
    };
    const report = await runEmployerDiscoveryBatch({
      db: db as never,
      provider,
      now: new Date('2026-09-11T12:00:00Z'),
      cycleYear: 2027,
      employerLimit: 1,
      resultsPerQuery: 1,
      offset: 0,
      runId: 'fixture-run',
    });
    expect(report).toMatchObject({ employers: 1, queries: 5, results: 5, archived: 5, errors: [] });
    expect(rpcCalls).toHaveLength(5);
    expect(rpcCalls.some((call) => call.p_resolution === 'linkedin_only')).toBe(true);
    expect(rpcCalls.some((call) => call.p_resolution === 'official_source_found')).toBe(true);
    expect(rpcCalls.every((call) => !('p_public_safe' in call) && !('p_review_status' in call))).toBe(true);
  });

  it('uses a stable observation key when the same run is retried later', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const db = { rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: 'lead-id', error: null };
    } };
    const base: DiscoveryLeadObservation = {
      runId: 'stable-run', route: 'web_search', query: 'internship', lane: null,
      originalUrl: 'https://example.org/jobs/1', normalizedUrl: 'https://example.org/jobs/1',
      visibleTitle: 'Intern', visibleSnippet: null, employerHint: 'Example', originalReachable: true,
      resolution: 'unresolved', canonicalEmployerUrl: null, archiveReason: 'Retained for review.',
      rawMetadata: {}, retrievedAt: '2026-09-11T12:00:00Z',
    };
    await archiveDiscoveryLead(db as never, base);
    await archiveDiscoveryLead(db as never, { ...base, retrievedAt: '2026-09-11T13:00:00Z' });
    expect(calls[0].p_observation_key).toBe(calls[1].p_observation_key);
  });
});
