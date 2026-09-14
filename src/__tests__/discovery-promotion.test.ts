import { describe, expect, it } from 'vitest';
import { resolveDiscoveryPromotion } from '../lib/discovery-promotion';

describe('resolveDiscoveryPromotion', () => {
  it('allows a resolved employer-controlled HTTPS source to become a private draft', () => {
    expect(resolveDiscoveryPromotion({
      resolution: 'official_source_found',
      canonicalEmployerUrl: 'https://jobs.example.com/role/123',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    })).toEqual({
      ready: true,
      canonicalUrl: 'https://jobs.example.com/role/123',
      employer: 'Example Bio',
      title: 'Research Intern',
    });
  });

  it('keeps LinkedIn-only leads in discovery', () => {
    const result = resolveDiscoveryPromotion({
      resolution: 'linkedin_only',
      canonicalEmployerUrl: null,
      employerHint: 'Example Bio',
      title: 'Research Intern',
    });
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/employer-controlled source/i);
  });

  it('rejects non-HTTPS canonical URLs', () => {
    const result = resolveDiscoveryPromotion({
      resolution: 'official_source_found',
      canonicalEmployerUrl: 'http://jobs.example.com/role/123',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    });
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/https/i);
  });

  it('requires employer and title identity before promotion', () => {
    const result = resolveDiscoveryPromotion({
      resolution: 'official_source_found',
      canonicalEmployerUrl: 'https://jobs.example.com/role/123',
      employerHint: null,
      title: 'Research Intern',
    });
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.reason).toMatch(/employer/i);
  });
});
