/**
 * Supabase adapter for the extraction stage.
 *
 * Fetching and normalized posting persistence already live in lib/ingestion and
 * migrations 0003-0006. This adapter starts from their immutable posting
 * versions. It does not create a second source, candidate, or publication store.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertPrivilegedRuntimeAllowed } from '@/lib/supabase/runtime-safety';
import type { Classification } from './classify';
import type { ExtractedField } from './evidence';

export interface ExtractionInboxRow {
  source_posting_version_id: string;
  source_posting_id: string;
  opportunity_id: string | null;
  employer: string;
  title: string;
  canonical_url: string;
  relevance_score: number | null;
  raw_text: string | null;
  created_at: string;
}

export interface PersistExtractionInput {
  sourcePostingVersionId: string;
  opportunityId: string | null;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  taxonomyVersion: number;
  classification: Classification;
  fields: Record<string, ExtractedField>;
  bindings: Record<string, unknown>;
  evidenceOk: boolean;
  bindingFailures: string[];
  injectionFlags: string[];
  inputTokens?: number;
  outputTokens?: number;
  traceId?: string;
  priority: number;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required in the extraction worker environment`);
  return value;
}

export function createPipelineServiceClient(
  url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
): SupabaseClient {
  assertPrivilegedRuntimeAllowed();
  return createClient(required('SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL', url), required('SUPABASE_SECRET_KEY', key), {
    auth: { persistSession: false },
    global: { headers: { 'x-client-info': 'csulb-hub-extraction-worker' } },
  });
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export class SupabaseExtractionStore {
  constructor(private readonly db: SupabaseClient) {}

  async next(schemaVersion: number, promptVersion: string, limit = 25): Promise<ExtractionInboxRow[]> {
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new Error('load extraction inbox: schemaVersion must be a positive integer');
    }
    if (!promptVersion.trim()) {
      throw new Error('load extraction inbox: promptVersion is required');
    }
    const bounded = Math.max(1, Math.min(limit, 100));
    const { data, error } = await this.db.rpc('pending_pipeline_extractions', {
      p_schema_version: schemaVersion,
      p_prompt_version: promptVersion,
      p_limit: bounded,
    });
    fail('load extraction inbox', error);
    return (data ?? []) as ExtractionInboxRow[];
  }

  async save(input: PersistExtractionInput): Promise<string> {
    const { data, error } = await this.db.rpc('persist_pipeline_extraction', {
      p_source_posting_version_id: input.sourcePostingVersionId,
      p_opportunity_id: input.opportunityId,
      p_model: input.model,
      p_prompt_version: input.promptVersion,
      p_schema_version: input.schemaVersion,
      p_taxonomy_version: input.taxonomyVersion,
      p_classification: input.classification,
      p_fields: input.fields,
      p_bindings: input.bindings,
      p_evidence_ok: input.evidenceOk,
      p_binding_failures: input.bindingFailures,
      p_injection_flags: input.injectionFlags,
      p_input_tokens: input.inputTokens ?? null,
      p_output_tokens: input.outputTokens ?? null,
      p_trace_id: input.traceId ?? null,
      p_priority: Math.max(1, input.priority),
    });
    fail('persist extraction', error);
    if (typeof data !== 'string') throw new Error('persist extraction: database returned no id');
    return data;
  }
}
