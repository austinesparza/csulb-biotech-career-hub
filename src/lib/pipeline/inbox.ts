/**
 * inbox.ts — officer review API. Framework-agnostic handlers; wire them to
 * Next route handlers, Hono, or Supabase Edge Functions.
 *
 * The rules that matter:
 *   1. Every handler verifies the caller is an ACTIVE officer, server-side.
 *      Never trust a client-supplied officer id.
 *   2. Approving requires the officer to have set a bucket and a reason. The
 *      model's suggestion is a default, never a decision.
 *   3. Editing a field CLEARS its evidence quote unless the officer's new text
 *      still appears in the source. An officer-authored value is legitimate, but
 *      it must not inherit a citation it no longer matches.
 *   4. Every decision is attributed and timestamped.
 */
import { bindExtraction, type ExtractedField } from "./evidence";

export interface Ctx {
  /** Resolved server-side from the session, never from the request body. */
  officerId: string | null;
  isActiveOfficer: boolean;
}

export interface ApiResult<T = unknown> {
  status: number;
  body: T | { error: string; detail?: unknown };
}

const forbidden = (): ApiResult => ({ status: 403, body: { error: "active officer required" } });
const badRequest = (error: string, detail?: unknown): ApiResult => ({ status: 400, body: { error, detail } });

export interface InboxDeps {
  listQueue(filter: { state: string; limit: number; offset: number }): Promise<unknown[]>;
  getItem(id: string): Promise<{
    id: string; state: string; candidate: { employer: string; title: string; url: string; suggestedBucket: string };
    rawText: string; fields: Record<string, ExtractedField>; bindings: Record<string, unknown>;
  } | null>;
  saveDecision(input: {
    id: string; officerId: string; state: "approved" | "rejected" | "needs_info" | "duplicate";
    finalFields?: Record<string, ExtractedField>; finalBucket?: string; finalReason?: string; notes?: string;
  }): Promise<void>;
  publish(id: string, officerId: string): Promise<{ publishedId: string }>;
}

const BUCKETS = ["graduate", "special", "adjacent", "excluded"];

export async function listInbox(ctx: Ctx, query: { state?: string; limit?: number; offset?: number }, deps: InboxDeps): Promise<ApiResult> {
  if (!ctx.isActiveOfficer) return forbidden();
  const state = query.state ?? "pending";
  if (!["pending", "approved", "rejected", "needs_info", "duplicate"].includes(state)) return badRequest("unknown state");
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const items = await deps.listQueue({ state, limit, offset: Math.max(query.offset ?? 0, 0) });
  return { status: 200, body: { items, limit } };
}

export interface DecisionBody {
  state: "approved" | "rejected" | "needs_info" | "duplicate";
  fields?: Record<string, ExtractedField>;
  bucket?: string;
  reason?: string;
  notes?: string;
}

/**
 * Re-verifies edited fields against the stored source text. An officer may
 * legitimately correct a value the model got wrong; when they do, the quote is
 * dropped rather than left pointing at unrelated text.
 */
export function reconcileEdits(
  edited: Record<string, ExtractedField>,
  rawText: string,
): { fields: Record<string, ExtractedField>; unquoted: string[] } {
  const binding = bindExtraction(edited as never, rawText);
  const fields: Record<string, ExtractedField> = {};
  const unquoted: string[] = [];
  for (const [name, field] of Object.entries(edited)) {
    const bound = binding.fields[name];
    if (field.quote && bound && !bound.ok) {
      fields[name] = { value: field.value, quote: null };   // officer-authored, uncited
      unquoted.push(name);
    } else {
      fields[name] = field;
    }
  }
  return { fields, unquoted };
}

export async function decide(ctx: Ctx, id: string, body: DecisionBody, deps: InboxDeps): Promise<ApiResult> {
  if (!ctx.isActiveOfficer || !ctx.officerId) return forbidden();
  const item = await deps.getItem(id);
  if (!item) return { status: 404, body: { error: "not found" } };
  if (item.state !== "pending") return { status: 409, body: { error: `already ${item.state}` } };

  if (body.state === "approved") {
    // The model's suggestion never becomes a decision by default.
    if (!body.bucket || !BUCKETS.includes(body.bucket)) {
      return badRequest("approving requires an explicit audience bucket", { allowed: BUCKETS });
    }
    if (!body.reason || body.reason.trim().length < 20) {
      return badRequest("approving requires a plain-language reason of at least 20 characters");
    }
    if (body.bucket === "excluded" && body.reason.trim().length < 40) {
      return badRequest("excluded records need a specific exclusion reason of at least 40 characters");
    }
    const { fields, unquoted } = reconcileEdits(body.fields ?? item.fields, item.rawText);
    await deps.saveDecision({
      id, officerId: ctx.officerId, state: "approved",
      finalFields: fields, finalBucket: body.bucket, finalReason: body.reason.trim(), notes: body.notes,
    });
    const { publishedId } = await deps.publish(id, ctx.officerId);
    return { status: 200, body: { publishedId, unquotedFields: unquoted } };
  }

  if (body.state === "rejected" && (!body.notes || body.notes.trim().length < 10)) {
    return badRequest("rejecting requires a short note, so the next officer knows why");
  }
  await deps.saveDecision({ id, officerId: ctx.officerId, state: body.state, notes: body.notes });
  return { status: 200, body: { ok: true, state: body.state } };
}

/** Read-only detail view: extraction beside the source text, so an officer can check a quote in place. */
export async function getForReview(ctx: Ctx, id: string, deps: InboxDeps): Promise<ApiResult> {
  if (!ctx.isActiveOfficer) return forbidden();
  const item = await deps.getItem(id);
  if (!item) return { status: 404, body: { error: "not found" } };
  const binding = bindExtraction(item.fields as never, item.rawText);
  return {
    status: 200,
    body: {
      ...item,
      evidenceOk: binding.ok,
      failures: binding.failures,
      // Character offsets let the UI highlight each quote inside the source.
      highlights: Object.entries(binding.fields)
        .filter(([, b]) => b.start !== null)
        .map(([field, b]) => ({ field, start: b.start, end: b.end })),
    },
  };
}
