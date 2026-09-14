import { describe, expect, it } from 'vitest';
import {
  resolveDiscoveryPromotion,
  resolveVerifiedLinkedInPromotion,
  validateEmployerControlledSourceUrl,
} from '../lib/discovery-promotion';

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

describe('validateEmployerControlledSourceUrl', () => {
  it('accepts employer and recruiting-system HTTPS URLs', () => {
    expect(validateEmployerControlledSourceUrl('https://company.example/careers/job/1')).toEqual({
      valid: true,
      canonicalUrl: 'https://company.example/careers/job/1',
    });
    expect(validateEmployerControlledSourceUrl('https://company.wd5.myworkdayjobs.com/job/role')).toEqual({
      valid: true,
      canonicalUrl: 'https://company.wd5.myworkdayjobs.com/job/role',
    });
  });

  it('rejects LinkedIn and shortened LinkedIn URLs as publication provenance', () => {
    const linkedIn = validateEmployerControlledSourceUrl('https://www.linkedin.com/jobs/view/123');
    expect(linkedIn.valid).toBe(false);
    if (!linkedIn.valid) expect(linkedIn.reason).toMatch(/discovery evidence/i);

    const shortened = validateEmployerControlledSourceUrl('https://lnkd.in/example');
    expect(shortened.valid).toBe(false);
  });

  it('rejects common job aggregators and non-HTTPS URLs', () => {
    expect(validateEmployerControlledSourceUrl('https://www.indeed.com/viewjob?jk=123').valid).toBe(false);
    const insecure = validateEmployerControlledSourceUrl('http://careers.example.com/job/123');
    expect(insecure.valid).toBe(false);
    if (!insecure.valid) expect(insecure.reason).toMatch(/https/i);
  });
});

describe('resolveVerifiedLinkedInPromotion', () => {
  it('allows a direct first-party LinkedIn job when separate employer evidence is supplied', () => {
    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/jobs/view/4463619983',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: 'Example Bio',
      title: 'Research Intern - Cell Biology',
    })).toEqual({
      ready: true,
      postingUrl: 'https://www.linkedin.com/jobs/view/4463619983',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employer: 'Example Bio',
      title: 'Research Intern - Cell Biology',
    });
  });

  it('rejects shortened LinkedIn and non-job LinkedIn URLs', () => {
    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://lnkd.in/example',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    }).ready).toBe(false);

    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/company/example-bio',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    }).ready).toBe(false);
  });

  it('rejects aggregator or social URLs as employer evidence', () => {
    const indeed = resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      employerEvidenceUrl: 'https://www.indeed.com/viewjob?jk=123',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    });
    expect(indeed.ready).toBe(false);
    if (!indeed.ready) expect(indeed.reason).toMatch(/discovery evidence/i);

    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      employerEvidenceUrl: 'https://www.linkedin.com/company/example-bio',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    }).ready).toBe(false);
  });

  it('does not apply the exception to already resolved or non-LinkedIn leads', () => {
    const resolved = resolveVerifiedLinkedInPromotion({
      resolution: 'official_source_found',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    });
    expect(resolved.ready).toBe(false);
    if (!resolved.ready) expect(resolved.reason).toMatch(/linkedin-only/i);

    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://jobs.examplebio.com/role/123',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    }).ready).toBe(false);
  });

  it('requires employer identity, title, and employer evidence', () => {
    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      employerEvidenceUrl: '',
      employerHint: 'Example Bio',
      title: 'Research Intern',
    }).ready).toBe(false);

    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: null,
      title: 'Research Intern',
    }).ready).toBe(false);

    expect(resolveVerifiedLinkedInPromotion({
      resolution: 'linkedin_only',
      originalUrl: 'https://www.linkedin.com/jobs/view/123456',
      employerEvidenceUrl: 'https://www.examplebio.com/careers',
      employerHint: 'Example Bio',
      title: null,
    }).ready).toBe(false);
  });
});
