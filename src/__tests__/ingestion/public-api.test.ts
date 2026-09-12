import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fetchPublicApiJobs } from '../../lib/ingestion/connectors/public-api';

function fixture(name: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/__tests__/pipeline/fixtures', name), 'utf8');
}

function response(body: string) {
  return async (url: string) => ({
    status: 200,
    finalUrl: url,
    etag: 'fixture-etag',
    lastModified: null,
    body,
  } as const);
}

describe('canonical public ATS ingestion adapters', () => {
  it('turns an Ashby response into persistence-ready candidates', async () => {
    const result = await fetchPublicApiJobs({
      source: {
        source_name: 'Example Bio', source_kind: 'ashby',
        source_identifier: 'example', api_endpoint: null,
      },
      fetcher: response(fixture('ashby.json')),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recordsSeen).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      sourceKind: 'ashby',
      titleRaw: 'Computational Biology Intern - Single Cell',
      remoteType: 'onsite',
      connectorVersion: 'ashby/1.0.0',
    });
    expect(result.candidates[0].identityKey).toContain('ashby:example:');
    expect(result.candidates[0].materialHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('turns a Lever response into persistence-ready candidates', async () => {
    const result = await fetchPublicApiJobs({
      source: {
        source_name: 'Amgen', source_kind: 'lever',
        source_identifier: 'example', api_endpoint: null,
      },
      fetcher: response(fixture('lever.json')),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].employmentType).toBeTruthy();
    expect(result.candidates[0].descriptionText).toContain('completed at least one year');
  });

  it('fails closed when USAJOBS credentials are absent', async () => {
    const result = await fetchPublicApiJobs({
      source: {
        source_name: 'USAJOBS', source_kind: 'usajobs',
        source_identifier: JSON.stringify({ Keyword: 'bioinformatics intern' }),
        api_endpoint: null,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.errorClass).toBe('auth');
    expect(result.rawResponseText).toBeNull();
  });

  it('archives malformed vendor output as a schema failure', async () => {
    const result = await fetchPublicApiJobs({
      source: {
        source_name: 'Example Bio', source_kind: 'ashby',
        source_identifier: 'example', api_endpoint: null,
      },
      fetcher: response('<html>temporary outage</html>'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_shape');
    expect(result.rawResponseText).toContain('temporary outage');
  });

  it('does not accept an insecure posting URL from an official feed', async () => {
    const result = await fetchPublicApiJobs({
      source: {
        source_name: 'Example Bio', source_kind: 'lever',
        source_identifier: 'example', api_endpoint: null,
      },
      fetcher: response(JSON.stringify([{
        id: 'insecure', text: 'Biology Intern', hostedUrl: 'http://jobs.lever.co/example/insecure',
      }])),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(0);
    expect(result.issues[0]?.message).toContain('stable HTTPS URL');
  });
});
