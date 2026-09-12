import { describe, expect, it, vi } from 'vitest';

import { createSupabaseIngestionRepository } from '../../lib/ingestion/persistence/repository';

function opportunityRow() {
  return {
    id: 'opp-1',
    company_id: 'company-1',
    title: 'Automation Scientist Intern',
    posting_url: 'https://example.org/jobs/1',
    dedupe_key: 'company|automation scientist intern|https://example.org/jobs/1',
    family_key: 'company|automation scientist intern',
    review_status: 'pending',
    public_safe: false,
    last_seen_at: '2026-09-12T00:00:00.000Z',
    location: 'Boston, Massachusetts',
    eligibility: null,
    focus_area: 'Laboratory automation',
    deadline: null,
    deadline_text: null,
    paid_status: 'paid',
    application_type: 'internship',
    source_status_raw: 'open',
    status: 'needs_review',
  };
}

function pendingInput() {
  return {
    companyId: 'company-1',
    sourceRecordId: 'source-record-1',
    title: 'Automation Scientist Intern',
    postingUrl: 'https://example.org/jobs/1',
    location: 'Boston, Massachusetts',
    focusArea: 'Laboratory automation',
    deadline: null,
    deadlineText: null,
    paidStatus: 'paid' as const,
    applicationType: 'internship',
    sourceStatusRaw: 'open',
    relevanceScore: 70,
    dedupeKey: 'company|automation scientist intern|https://example.org/jobs/1',
    familyKey: 'company|automation scientist intern',
    observedAtIso: '2026-09-12T00:00:00.000Z',
  };
}

function repositoryWithRpc(rpc: ReturnType<typeof vi.fn>) {
  const row = opportunityRow();
  const db = {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: row, error: null })),
        })),
      })),
    })),
  };
  const storage = {
    from: vi.fn(() => ({
      upload: vi.fn(async () => ({ error: null })),
    })),
  };
  return createSupabaseIngestionRepository({ db: db as never, storage });
}

describe('Supabase ingestion RPC retries', () => {
  it('retries one transient gateway timeout for idempotent opportunity creation', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'Gateway Timeout', code: '504' } })
      .mockResolvedValueOnce({ data: [{ opportunity_id: 'opp-1' }], error: null });
    const repository = repositoryWithRpc(rpc);

    const result = await repository.insertPendingOpportunity(pendingInput());

    expect(result.id).toBe('opp-1');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent database errors', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'invalid input value for enum', code: '22P02' },
    });
    const repository = repositoryWithRpc(rpc);

    await expect(repository.insertPendingOpportunity(pendingInput()))
      .rejects.toThrow('invalid input value for enum');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
