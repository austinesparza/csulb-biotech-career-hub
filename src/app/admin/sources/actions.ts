"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { runClaimedFetch } from "@/lib/ingestion/source-runner";
import { assertSafePublicUrl } from "@/lib/pipeline/safe-fetch";
import { createServiceClient, requireOfficer } from "@/lib/supabase/server";

const KINDS = new Set(["greenhouse", "static_html", "schema_org"]);

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
  const enabled = checked(formData, "enabled");

  if (!sourceName) throw new Error("Source name is required.");
  if (!KINDS.has(sourceKind)) throw new Error("Unsupported source kind.");
  if (!Number.isInteger(interval) || interval < 24 || interval > 720) {
    throw new Error("Fetch interval must be between 24 and 720 hours.");
  }
  if (sourceKind === "greenhouse" && !sourceIdentifier) {
    throw new Error("Greenhouse sources require the board token.");
  }
  if (enabled && (!termsReviewed || !robotsReviewed)) {
    throw new Error("Record both terms and robots review before enabling a source.");
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
    enabled,
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

export async function runSourceNow(formData: FormData): Promise<void> {
  await requireOfficer();
  const db = createServiceClient();
  const id = field(formData, "id");
  const { data: source, error: sourceError } = await db.from("job_sources")
    .select("id, enabled, automatic_scheduling_paused_at")
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

  await runClaimedFetch({ db, storage: db.storage, claim: run });
  refresh();
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
