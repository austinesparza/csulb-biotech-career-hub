"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { googleSheetsConfigured } from "@/lib/google-sheets";
import { runClaimedFetch } from "@/lib/ingestion/source-runner";
import { governedStarterSource, GREENHOUSE_POLICY_LINKS } from "@/lib/ingestion/starter-sources";
import { assertSafePublicUrl } from "@/lib/pipeline/safe-fetch";
import { syncReviewQueueToGoogleSheet } from "@/lib/review-sheet-sync";
import { createBraveSearchProvider } from "@/lib/pipeline/brave-search";
import { runEmployerDiscoveryBatch } from "@/lib/pipeline/discovery-runner";
import { createServiceClient, requireOfficer } from "@/lib/supabase/server";

const KINDS = new Set(["greenhouse", "ashby", "lever", "usajobs", "static_html", "schema_org"]);

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function refresh(): void {
  revalidatePath("/admin/sources");
  revalidatePath("/admin/integrations");
}

export async function createJobSource(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const db = createServiceClient();
  const sourceName = field(formData, "source_name");
  const sourceKind = field(formData, "source_kind");
  const careersUrl = (await assertSafePublicUrl(field(formData, "careers_url"))).toString();
  const sourceIdentifier = field(formData, "source_identifier") || null;
  const interval = Number(field(formData, "fetch_interval_hours") || 24);
  const termsReviewed = checked(formData, "terms_reviewed");
  const robotsReviewed = checked(formData, "robots_reviewed");

  if (!sourceName) throw new Error("Source name is required.");
  if (!KINDS.has(sourceKind)) throw new Error("Unsupported source kind.");
  if (!Number.isInteger(interval) || interval < 24 || interval > 720) {
    throw new Error("Fetch interval must be between 24 and 720 hours.");
  }
  if (sourceKind === "greenhouse" && !sourceIdentifier) {
    throw new Error("Greenhouse sources require the board token.");
  }
  if (["ashby", "lever", "usajobs"].includes(sourceKind) && !sourceIdentifier) {
    throw new Error(`${sourceKind} sources require a board identifier or query configuration.`);
  }
  const { data: provenance, error: provenanceError } = await db.from("source_records").insert({
    name: sourceName,
    source_type: "website_page",
    url: careersUrl,
    owner: "CSULB Biotechnology Club",
    access_level: "officers",
    canonical_status: "active",
    refresh_policy: `Every ${interval} hours after policy review`,
    public_safe: false,
    notes: "Created from the officer source-control screen.",
  }).select("id").single();
  if (provenanceError || !provenance) {
    throw new Error(`Could not create provenance record: ${provenanceError?.message ?? "unknown error"}`);
  }

  const { error } = await db.from("job_sources").insert({
    source_record_id: provenance.id,
    source_name: sourceName,
    source_kind: sourceKind,
    source_identifier: sourceIdentifier,
    careers_url: careersUrl,
    enabled: false,
    fetch_interval_hours: interval,
    terms_reviewed: termsReviewed,
    terms_review_date: termsReviewed ? new Date().toISOString().slice(0, 10) : null,
    robots_reviewed: robotsReviewed,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error) {
    await db.from("source_records").delete().eq("id", provenance.id);
    throw new Error(`Could not create job source: ${error.message}`);
  }
  refresh();
}

export async function createStarterSource(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const db = createServiceClient();
  const starter = governedStarterSource(field(formData, "starter_id"));
  if (!starter) throw new Error("Unknown starter source.");

  const careersUrl = (await assertSafePublicUrl(starter.careersUrl)).toString();
  const { data: existing, error: existingError } = await db.from("job_sources")
    .select("id")
    .eq("source_kind", "greenhouse")
    .eq("source_identifier", starter.boardToken)
    .limit(1);
  if (existingError) throw new Error(`Could not check starter source: ${existingError.message}`);
  if ((existing ?? []).length > 0) {
    refresh();
    return;
  }

  const { data: provenance, error: provenanceError } = await db.from("source_records").insert({
    name: `${starter.sourceName} careers board`,
    source_type: "website_page",
    url: careersUrl,
    owner: "CSULB Biotechnology Club",
    access_level: "officers",
    canonical_status: "active",
    refresh_policy: `Every ${starter.fetchIntervalHours} hours after policy review`,
    public_safe: false,
    notes: `Governed starter source. ${starter.rationale}`,
  }).select("id").single();
  if (provenanceError || !provenance) {
    throw new Error(`Could not create starter provenance: ${provenanceError?.message ?? "unknown error"}`);
  }

  const { error } = await db.from("job_sources").insert({
    source_record_id: provenance.id,
    source_name: starter.sourceName,
    source_kind: "greenhouse",
    source_identifier: starter.boardToken,
    careers_url: careersUrl,
    enabled: false,
    fetch_interval_hours: starter.fetchIntervalHours,
    terms_reviewed: false,
    terms_review_date: null,
    robots_reviewed: false,
    notes: `Starter added disabled. Review ${GREENHOUSE_POLICY_LINKS.apiDocumentation}, ${GREENHOUSE_POLICY_LINKS.apiRobots}, and ${GREENHOUSE_POLICY_LINKS.boardRobots} before testing or enabling.`,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error) {
    await db.from("source_records").delete().eq("id", provenance.id);
    throw new Error(`Could not create starter source: ${error.message}`);
  }
  refresh();
}

export async function updateSourceGovernance(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const db = createServiceClient();
  const id = field(formData, "id");
  const termsReviewed = checked(formData, "terms_reviewed");
  const robotsReviewed = checked(formData, "robots_reviewed");
  const enabled = checked(formData, "enabled");
  if (!id) throw new Error("Source ID is required.");
  if (enabled && (!termsReviewed || !robotsReviewed)) {
    throw new Error("Record both terms and robots review before enabling a source.");
  }
  const { error } = await db.from("job_sources").update({
    terms_reviewed: termsReviewed,
    terms_review_date: termsReviewed ? new Date().toISOString().slice(0, 10) : null,
    robots_reviewed: robotsReviewed,
    enabled,
    updated_by: user.id,
  }).eq("id", id);
  if (error) throw new Error(`Could not update source: ${error.message}`);
  refresh();
}

export async function toggleSourcePause(formData: FormData): Promise<void> {
  const { user } = await requireOfficer();
  const db = createServiceClient();
  const id = field(formData, "id");
  const paused = checked(formData, "paused");
  const { error } = await db.from("job_sources").update({
    automatic_scheduling_paused_at: paused ? new Date().toISOString() : null,
    updated_by: user.id,
  }).eq("id", id);
  if (error) throw new Error(`Could not update source pause: ${error.message}`);
  refresh();
}

export interface SourceRunActionState {
  status: "idle" | "success" | "error";
  message: string;
  runId?: string;
}

function safeSourceRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "Not signed in") return "Your officer session expired. Refresh and sign in again.";
  if (message === "Not an active officer") return "This account is not an active officer.";
  if (message === "Source not found." || message === "Enable and resume the source before running it.") return message;
  if (/^Source run [0-9a-f-]+ was archived, but the Review Queue Sheet update failed:/.test(message)) return message;
  if (message.startsWith("Could not start source run:")) {
    return "The database rejected the source-run record. No source fetch started.";
  }
  return "The source run failed before completion. No opportunity was published.";
}

export async function runSourceNow(
  _previousState: SourceRunActionState,
  formData: FormData,
): Promise<SourceRunActionState> {
  const id = field(formData, "id");
  let runId: string | undefined;
  console.info("[source-run] action received", { sourceId: id || null });
  try {
    await requireOfficer();
    const db = createServiceClient();
    const { data: source, error: sourceError } = await db.from("job_sources")
      .select("id, source_name, enabled, automatic_scheduling_paused_at")
      .eq("id", id)
      .maybeSingle();
    if (sourceError || !source) throw new Error("Source not found.");
    if (!source.enabled || source.automatic_scheduling_paused_at) {
      throw new Error("Enable and resume the source before running it.");
    }
    const { data: run, error } = await db.from("source_fetch_runs").insert({
      job_source_id: id,
      trigger_kind: "manual",
      status: "running",
      scheduled_for: new Date().toISOString(),
      started_at: new Date().toISOString(),
      worker_id: `officer:${randomUUID()}`,
    }).select("id, job_source_id").single();
    if (error || !run) throw new Error(`Could not start source run: ${error?.message ?? "unknown error"}`);
    runId = run.id;
    console.info("[source-run] fetch record created", { sourceId: id, runId: run.id });

    const report = await runClaimedFetch({ db, storage: db.storage, claim: run });
    console.info("[source-run] fetch completed", {
      sourceId: id,
      runId: report.fetchRunId,
      status: report.status,
      recordsSeen: report.recordsSeen,
      reviewTasksCreated: report.reviewTasksCreated,
    });
    if (report.status === "failed") {
      refresh();
      return {
        status: "error",
        runId: report.fetchRunId,
        message: `The source fetch failed and was archived as run ${report.fetchRunId}. No opportunity was published.`,
      };
    }
    if (googleSheetsConfigured()) {
      try {
        await syncReviewQueueToGoogleSheet({ db });
      } catch (sheetError) {
        refresh();
        const message = sheetError instanceof Error ? sheetError.message : "unknown error";
        throw new Error(
          `Source run ${report.fetchRunId} was archived, but the Review Queue Sheet update failed: ${message}. Use Spreadsheet intake to retry the Sheet push without rerunning the source.`,
        );
      }
    }
    refresh();
    return {
      status: "success",
      runId: report.fetchRunId,
      message: `${source.source_name}: ${report.recordsSeen} records checked and ${report.reviewTasksCreated} review tasks created.`,
    };
  } catch (error) {
    const safeMessage = safeSourceRunError(error);
    const message = runId && safeMessage === "The source run failed before completion. No opportunity was published."
      ? `${safeMessage} Run ID: ${runId}.`
      : safeMessage;
    console.error("[source-run] action failed", { sourceId: id || null, error: message });
    return { status: "error", message, ...(runId ? { runId } : {}) };
  }
}

export async function testSourceNow(formData: FormData): Promise<void> {
  await requireOfficer();
  const db = createServiceClient();
  const id = field(formData, "id");
  const { data: source, error: sourceError } = await db.from("job_sources")
    .select("id, terms_reviewed, terms_review_date, robots_reviewed")
    .eq("id", id)
    .maybeSingle();
  if (sourceError || !source) throw new Error("Source not found.");
  if (!source.terms_reviewed || !source.terms_review_date || !source.robots_reviewed) {
    throw new Error("Record both terms and robots review before testing a source.");
  }

  const { data: run, error } = await db.from("source_fetch_runs").insert({
    job_source_id: id,
    trigger_kind: "manual",
    status: "running",
    scheduled_for: new Date().toISOString(),
    started_at: new Date().toISOString(),
    worker_id: `officer-test:${randomUUID()}`,
    log_json: { privateTest: true },
  }).select("id, job_source_id").single();
  if (error || !run) throw new Error(`Could not start private test: ${error?.message ?? "unknown error"}`);

  await runClaimedFetch({ db, storage: db.storage, claim: run, privateTest: true });
  refresh();
}

export async function runEmployerDiscoveryNow(): Promise<void> {
  await requireOfficer();
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (process.env.DISCOVERY_SEARCH_ENABLED !== "true" || !apiKey) {
    throw new Error("Governed search discovery is not configured.");
  }
  const provider = createBraveSearchProvider({
    apiKey,
    storageRightsConfirmed: process.env.BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED === "true",
  });
  const report = await runEmployerDiscoveryBatch({
    db: createServiceClient(),
    provider,
    employerLimit: 1,
    resultsPerQuery: 5,
    runId: `officer:${new Date().toISOString()}`,
  });
  if (report.errors.length > 0) {
    throw new Error(`Discovery archived ${report.archived} results with ${report.errors.length} errors. Check runtime logs.`);
  }
  refresh();
  revalidatePath("/admin/review");
}
