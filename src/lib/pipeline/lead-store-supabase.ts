import crypto from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DiscoveryRoute, LeadResolution } from "./search-plan";

export interface DiscoveryLeadObservation {
  runId: string;
  route: DiscoveryRoute;
  query: string | null;
  lane: string | null;
  originalUrl: string;
  normalizedUrl: string | null;
  visibleTitle: string | null;
  visibleSnippet: string | null;
  employerHint: string | null;
  originalReachable: boolean;
  resolution: LeadResolution["resolution"];
  canonicalEmployerUrl: string | null;
  archiveReason: string;
  rawMetadata: Record<string, unknown>;
  retrievedAt: string;
}

function hash(parts: unknown[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Archives a discovery observation through the service-role-only RPC. */
export async function archiveDiscoveryLead(
  db: SupabaseClient,
  observation: DiscoveryLeadObservation,
): Promise<string> {
  const runId = observation.runId.trim();
  const originalUrl = observation.originalUrl.trim();
  if (!runId || !originalUrl) throw new Error("runId and originalUrl are required");
  if (!Number.isFinite(Date.parse(observation.retrievedAt))) throw new Error("retrievedAt must be an ISO timestamp");
  const leadKey = hash([observation.route, observation.normalizedUrl ?? originalUrl]);
  const observationKey = hash([leadKey, runId, observation.query, observation.retrievedAt]);
  const { data, error } = await db.rpc("archive_discovery_lead", {
    p_lead_key: leadKey,
    p_observation_key: observationKey,
    p_run_id: runId,
    p_route: observation.route,
    p_query: observation.query,
    p_lane: observation.lane,
    p_original_url: originalUrl,
    p_normalized_url: observation.normalizedUrl,
    p_visible_title: observation.visibleTitle,
    p_visible_snippet: observation.visibleSnippet,
    p_employer_hint: observation.employerHint,
    p_original_reachable: observation.originalReachable,
    p_canonical_employer_url: observation.canonicalEmployerUrl,
    p_resolution: observation.resolution,
    p_archive_reason: observation.archiveReason,
    p_raw_metadata: observation.rawMetadata,
    p_retrieved_at: observation.retrievedAt,
  });
  if (error) throw new Error(`archive discovery lead: ${error.message}`);
  if (typeof data !== "string" || !data) throw new Error("archive discovery lead returned no ID");
  return data;
}
