import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { assertClassificationFeedbackReady } from '../lib/classification-feedback';

describe('assertClassificationFeedbackReady', () => {
  it('blocks a review before mutation when the classification migration is absent', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.limit = async () => ({ data: null, error: { message: 'relation does not exist' } });
    const db = { from: () => chain } as unknown as SupabaseClient;

    await expect(assertClassificationFeedbackReady(db)).rejects.toThrow(/migration is deployed/i);
  });

  it('allows the review when the feedback table is readable', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    const db = { from: () => chain } as unknown as SupabaseClient;

    await expect(assertClassificationFeedbackReady(db)).resolves.toBeUndefined();
  });
});
