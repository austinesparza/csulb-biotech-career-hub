/**
 * store-supabase.ts — the real Store, matching the port the worker and tests use.
 *
 * Runs with the service_role key, so it lives ONLY in the worker environment
 * (see SECURITY.md: no GitHub token, no Google credentials in that container).
 *
 * Every method is idempotent. The worker may crash and re-run at any point.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Store, CandidateRow, ExtractionRow } from "./worker";

export function createServiceClient(url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!): SupabaseClient {
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in the worker environment");
  return createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-client-info": "csulb-hub-worker" } } });
}

const fail = (context: string, error: { message: string } | null) => {
  if (error) throw new Error(`${context}: ${error.message}`);
};

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async getSourceState(sourceId: string) {
    // Last successful fetch carries the conditional-GET state.
    const { data, error } = await this.db
      .from("source_fetches")
      .select("etag,last_modified,content_sha256")
      .eq("source_id", sourceId)
      .is("error", null)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    fail("getSourceState", error);
    return { etag: data?.etag ?? null, lastModified: data?.last_modified ?? null, lastHash: data?.content_sha256 ?? null };
  }

  async saveFetch(row: Parameters<Store["saveFetch"]>[0]) {
    const { error } = await this.db.from("source_fetches").insert({
      source_id: row.sourceId, url: row.url, http_status: row.status, etag: row.etag,
      last_modified: row.lastModified, content_sha256: row.hash, changed: row.changed, error: row.error ?? null,
    });
    fail("saveFetch", error);
  }

  async saveRawDocument(row: Parameters<Store["saveRawDocument"]>[0]) {
    // Content-addressed: the same text fetched twice is one row. `ignoreDuplicates`
    // makes a re-run cheap instead of an error.
    const { error } = await this.db.from("raw_documents")
      .upsert({ source_id: row.sourceId, url: row.url, content_sha256: row.hash, raw_text: row.rawText },
              { onConflict: "content_sha256", ignoreDuplicates: true });
    fail("saveRawDocument", error);
    const { data, error: selectError } = await this.db
      .from("raw_documents").select("id").eq("content_sha256", row.hash).single();
    fail("saveRawDocument.select", selectError);
    return data!.id as string;
  }

  async upsertCandidate(row: CandidateRow) {
    const c = row.classification;
    const payload = {
      raw_document_id: row.rawDocumentId, source_id: row.sourceId, external_id: row.externalId,
      employer: row.employer, title: row.title, url: row.url,
      taxonomy_version: row.taxonomyVersion, kept: c.keep, drop_reason: c.dropReason ?? null,
      lanes: c.lanes, functions: c.functions, methods: c.methods,
      opportunity_type: c.opportunityType, graduate_stage: c.stage.id,
      structural_gate: c.structuralGate, personal_gates: c.personalGates,
      suggested_bucket: c.suggestedBucket, score: c.score,
      last_seen_at: new Date().toISOString(),
      closed_at: null,                        // reappearing after a gap reopens it
    };
    const { data, error } = await this.db.from("candidates")
      .upsert(payload, { onConflict: "source_id,external_id" })
      .select("id,first_seen_at")
      .single();
    fail("upsertCandidate", error);
    const isNew = data!.first_seen_at === data!.first_seen_at && !(await this.wasSeenBefore(row.sourceId, row.externalId));
    return { id: data!.id as string, isNew };
  }

  private async wasSeenBefore(sourceId: string, externalId: string) {
    const { count } = await this.db.from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("source_id", sourceId).eq("external_id", externalId)
      .lt("first_seen_at", new Date(Date.now() - 60_000).toISOString());
    return (count ?? 0) > 0;
  }

  async hasExtraction(candidateId: string, schemaVersion: number, promptVersion: string) {
    const { count, error } = await this.db.from("extractions")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", candidateId).eq("schema_version", schemaVersion).eq("prompt_version", promptVersion);
    fail("hasExtraction", error);
    return (count ?? 0) > 0;
  }

  async saveExtraction(row: ExtractionRow) {
    const { data, error } = await this.db.from("extractions").insert({
      candidate_id: row.candidateId, model: row.model, prompt_version: row.promptVersion,
      schema_version: row.schemaVersion, fields: row.fields, bindings: row.bindings,
      evidence_ok: row.evidenceOk, binding_failures: row.bindingFailures, injection_flags: row.injectionFlags,
      input_tokens: row.inputTokens ?? null, output_tokens: row.outputTokens ?? null, trace_id: row.traceId ?? null,
    }).select("id").single();
    fail("saveExtraction", error);
    return data!.id as string;
  }

  async enqueueReview(row: { candidateId: string; extractionId: string; priority: number }) {
    // One queue row per candidate. A re-extraction updates the pointer and
    // priority but never resurrects a decision an officer already made.
    const { error } = await this.db.from("review_queue")
      .upsert({ candidate_id: row.candidateId, extraction_id: row.extractionId, priority: row.priority },
              { onConflict: "candidate_id", ignoreDuplicates: false })
      .eq("state", "pending");
    fail("enqueueReview", error);
  }

  /**
   * Anything not in this run's id list has disappeared from the board.
   * We mark it closed rather than deleting: a closed role is evidence, and next
   * year's recruiting window is inferred from these dates.
   */
  async markSeen(sourceId: string, externalIds: string[]) {
    const now = new Date().toISOString();
    if (externalIds.length > 0) {
      const { error } = await this.db.from("candidates")
        .update({ last_seen_at: now, closed_at: null })
        .eq("source_id", sourceId).in("external_id", externalIds);
      fail("markSeen", error);
    }
    // Close the rest, but only for ATS sources where absence is meaningful.
    // A 'page' source has one document, so absence means a parse failure.
    const { data: source } = await this.db.from("sources").select("kind").eq("id", sourceId).single();
    if (!source || source.kind === "page") return;
    let query = this.db.from("candidates")
      .update({ closed_at: now })
      .eq("source_id", sourceId).is("closed_at", null);
    if (externalIds.length > 0) query = query.not("external_id", "in", `(${externalIds.map((id) => `"${id}"`).join(",")})`);
    const { error } = await query;
    fail("markSeen.close", error);
  }

  async bumpSourceError(sourceId: string, error: string | null) {
    if (error === null) {
      const { error: e } = await this.db.from("sources")
        .update({ consecutive_errors: 0, last_error: null, last_polled_at: new Date().toISOString() })
        .eq("id", sourceId);
      fail("bumpSourceError.clear", e);
      return;
    }
    const { data } = await this.db.from("sources").select("consecutive_errors").eq("id", sourceId).single();
    const { error: e } = await this.db.from("sources")
      .update({ consecutive_errors: (data?.consecutive_errors ?? 0) + 1, last_error: error, last_polled_at: new Date().toISOString() })
      .eq("id", sourceId);
    fail("bumpSourceError.set", e);
  }
}

/** Sources due for a poll, per the recruiting-window cadence. */
export async function dueSources(db: SupabaseClient, limit = 25) {
  const { data, error } = await db.rpc("sources_due");
  fail("dueSources", error);
  return (data ?? []).slice(0, limit) as { id: string; kind: string; employer: string; identifier: string }[];
}

/**
 * Advisory lock so two overlapping cron runs cannot double-process.
 * Companion migration:
 *   create or replace function public.try_worker_lock(key bigint)
 *   returns boolean language sql as $$ select pg_try_advisory_lock(key) $$;
 *   create or replace function public.release_worker_lock(key bigint)
 *   returns boolean language sql as $$ select pg_advisory_unlock(key) $$;
 */
export async function withLock<T>(db: SupabaseClient, key: number, run: () => Promise<T>): Promise<T | null> {
  const { data: acquired } = await db.rpc("try_worker_lock", { key });
  if (!acquired) return null;
  try { return await run(); }
  finally { await db.rpc("release_worker_lock", { key }); }
}
