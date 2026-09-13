import { describe, expect, it } from 'vitest';

import { inferSourceIdentifier, resolveSourceIdentifier } from '@/lib/ingestion/source-identifiers';

describe('ATS source identifier inference', () => {
  it('infers Greenhouse tokens from public and API URLs', () => {
    expect(inferSourceIdentifier('greenhouse', 'https://job-boards.greenhouse.io/ginkgobioworks')).toBe('ginkgobioworks');
    expect(inferSourceIdentifier('greenhouse', 'https://boards.greenhouse.io/example_bio/jobs/123')).toBe('example_bio');
    expect(inferSourceIdentifier('greenhouse', 'https://boards-api.greenhouse.io/v1/boards/example-bio/jobs?content=true')).toBe('example-bio');
  });

  it('infers Lever company slugs from public and API URLs', () => {
    expect(inferSourceIdentifier('lever', 'https://jobs.lever.co/example-bio')).toBe('example-bio');
    expect(inferSourceIdentifier('lever', 'https://jobs.eu.lever.co/example_bio/abc123')).toBe('example_bio');
    expect(inferSourceIdentifier('lever', 'https://api.lever.co/v0/postings/example-bio?mode=json')).toBe('example-bio');
  });

  it('infers Ashby board names from public and API URLs', () => {
    expect(inferSourceIdentifier('ashby', 'https://jobs.ashbyhq.com/example-bio')).toBe('example-bio');
    expect(inferSourceIdentifier('ashby', 'https://api.ashbyhq.com/posting-api/job-board/example_bio?includeCompensation=true')).toBe('example_bio');
  });

  it('refuses unsupported or lookalike hosts', () => {
    expect(inferSourceIdentifier('lever', 'https://example.com/example-bio')).toBeNull();
    expect(inferSourceIdentifier('greenhouse', 'https://greenhouse.example.com/example-bio')).toBeNull();
    expect(inferSourceIdentifier('static_html', 'https://jobs.lever.co/example-bio')).toBeNull();
  });

  it('prefers explicit identifiers while accepting a pasted ATS URL', () => {
    expect(resolveSourceIdentifier({
      sourceKind: 'lever',
      explicitIdentifier: 'manual-company',
      careersUrl: 'https://jobs.lever.co/ignored-company',
    })).toBe('manual-company');
    expect(resolveSourceIdentifier({
      sourceKind: 'lever',
      explicitIdentifier: 'https://jobs.lever.co/from-pasted-url',
      careersUrl: 'https://example.com/careers',
    })).toBe('from-pasted-url');
  });
});
