import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { assertDiscoveryLearningReady, recordDiscoveryFeedback } from '../lib/discovery-feedback';

function mockDatabase() {
  let rpcArgs: Record<string, unknown> | null = null;
  const leadChain: Record<string, unknown> = {};
  leadChain.select = () => leadChain;
  leadChain.eq = () => leadChain;
  leadChain.single = async () => ({
    data: {
      id: '11111111-1111-4111-8111-111111111111',
      route: 'employer_page',
      resolution: 'official_source_found',
      occurrence_count: 2,
      employer_hint: 'Example Bio',
      latest_snippet: 'Graduate research internship',
      lane: 'cancer_oncology',
    },
    error: null,
  });
  const observationChain: Record<string, unknown> = {};
  observationChain.select = () => observationChain;
  observationChain.eq = () => observationChain;
  observationChain.order = () => observationChain;
  observationChain.limit = () => observationChain;
  observationChain.maybeSingle = async () => ({
    data: {
      raw_metadata: {
        rank: 1,
        discoveryBasis: 'historical_role_watch',
        queryRoute: 'employer_page',
        snippetTriage: { score: 30, keep: true, suggestedBucket: 'graduate' },
      },
    },
    error: null,
  });
  const db = {
    from: (table: string) => table === 'discovery_leads' ? leadChain : observationChain,
    rpc: async (_name: string, args: Record<string, unknown>) => {
      rpcArgs = args;
      return { data: '22222222-2222-4222-8222-222222222222', error: null };
    },
  } as unknown as SupabaseClient;
  return { db, getRpcArgs: () => rpcArgs };
}

describe('recordDiscoveryFeedback', () => {
  it('freezes the pre-decision feature vector and query family', async () => {
    const mock = mockDatabase();
    await recordDiscoveryFeedback(mock.db, {
      leadId: '11111111-1111-4111-8111-111111111111',
      decidedBy: '33333333-3333-4333-8333-333333333333',
      label: 'relevant',
      reason: 'Officer confirmed this role is relevant.',
      source: 'officer',
    });
    expect(mock.getRpcArgs()).toMatchObject({
      p_label: 'relevant',
      p_feature_schema_version: 1,
      p_query_family: 'historical_role_watch:employer_page:cancer_oncology',
      p_feature_snapshot: {
        triage_keep: 1,
        official_route: 1,
        historical_watch: 1,
      },
    });
  });

  it('rejects an attempt to archive a relevant lead before touching the database', async () => {
    const mock = mockDatabase();
    await expect(recordDiscoveryFeedback(mock.db, {
      leadId: '11111111-1111-4111-8111-111111111111',
      decidedBy: '33333333-3333-4333-8333-333333333333',
      label: 'relevant',
      reason: 'Relevant role for officer review.',
      source: 'officer',
      archiveLead: true,
    })).rejects.toThrow(/cannot archive/i);
    expect(mock.getRpcArgs()).toBeNull();
  });
});

describe('assertDiscoveryLearningReady', () => {
  it('stops a workflow before mutation when the migration is missing', async () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.limit = async () => ({ data: null, error: { message: 'relation does not exist' } });
    const db = { from: () => chain } as unknown as SupabaseClient;
    await expect(assertDiscoveryLearningReady(db)).rejects.toThrow(/migration is deployed/i);
  });
});
