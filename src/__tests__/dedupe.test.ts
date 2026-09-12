import { describe, expect, it } from 'vitest';
import { matchOpportunity, type ExistingOpportunity } from '../lib/dedupe';

const existing: ExistingOpportunity = {
  id: 'approved-opportunity',
  dedupe_key: null,
  family_key: null,
  posting_url: 'https://www.example.org/jobs/graduate-intern/',
  title: 'Graduate Intern',
  company_id: 'company-1',
  review_status: 'approved',
  public_safe: true,
};

describe('matchOpportunity', () => {
  it('matches equivalent URLs after canonicalization', () => {
    const result = matchOpportunity({
      dedupe_key: 'different-key',
      family_key: 'different-family',
      posting_url: 'https://www.example.org/jobs/graduate-intern?utm_source=sheet',
      title: 'Graduate Intern',
      companyId: 'company-1',
    }, [existing]);

    expect(result).toEqual({ kind: 'same_url', opportunityId: existing.id });
  });

  it('does not treat two invalid URLs as the same posting', () => {
    const result = matchOpportunity({
      dedupe_key: 'different-key',
      family_key: 'different-family',
      posting_url: 'not a valid URL',
      title: 'Distinct Role',
      companyId: 'company-2',
    }, [{ ...existing, posting_url: 'also not a valid URL', company_id: 'company-1' }]);

    expect(result.kind).toBe('none');
  });
});
