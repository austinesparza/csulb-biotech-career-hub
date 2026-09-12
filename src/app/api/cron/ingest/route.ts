import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/cron/auth";
import { googleSheetsConfigured } from "@/lib/google-sheets";
import { runIngestionBatch } from "@/lib/ingestion/source-runner";
import { createBraveSearchProvider } from "@/lib/pipeline/brave-search";
import { runEmployerDiscoveryBatch } from "@/lib/pipeline/discovery-runner";
import { runExtractionBatch } from "@/lib/pipeline/extraction-runner";
import { createOpenAiCompatibleExtractionModel } from "@/lib/pipeline/model-openai";
import { syncReviewQueueToGoogleSheet } from "@/lib/review-sheet-sync";
import { createPipelineServiceClient, SupabaseExtractionStore } from "@/lib/pipeline/store-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!authorizeCronRequest(request.headers.get("authorization"))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return json({ ok: false, error: "production_only" }, 403);
  }

  const db = createPipelineServiceClient();
  const requestedLimit = Number(process.env.PIPELINE_BATCH_LIMIT ?? 5);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 10)) : 5;
  const { data: scheduled, error: scheduleError } = await db.rpc("schedule_due_source_fetch_runs", {
    p_limit: limit,
  });
  if (scheduleError) {
    return json({ ok: false, stage: "schedule", error: scheduleError.message }, 500);
  }

  const reports = await runIngestionBatch({
    db,
    storage: db.storage,
    workerId: `vercel-cron:${randomUUID()}`,
    limit,
  });
  const failed = reports.filter((report) => report.status === "failed");
  let discoveryFailed = false;
  let discovery:
    | { status: "disabled" }
    | { status: "completed"; employers: number; queries: number; results: number; archived: number; errors: number }
    | { status: "failed"; error: string } = { status: "disabled" };
  if (process.env.DISCOVERY_SEARCH_ENABLED === "true") {
    try {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
      if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY is required");
      const provider = createBraveSearchProvider({
        apiKey,
        storageRightsConfirmed: process.env.BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED === "true",
      });
      const discoveryReport = await runEmployerDiscoveryBatch({
        db,
        provider,
        employerLimit: Math.max(1, Math.min(Number(process.env.EMPLOYER_DISCOVERY_BATCH_SIZE ?? 1) || 1, 5)),
        resultsPerQuery: Math.max(1, Math.min(Number(process.env.EMPLOYER_DISCOVERY_RESULTS_PER_QUERY ?? 5) || 5, 10)),
      });
      discoveryFailed = discoveryReport.errors.length > 0;
      discovery = {
        status: "completed",
        employers: discoveryReport.employers,
        queries: discoveryReport.queries,
        results: discoveryReport.results,
        archived: discoveryReport.archived,
        errors: discoveryReport.errors.length,
      };
    } catch (error) {
      discoveryFailed = true;
      discovery = {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown discovery failure",
      };
    }
  }
  let extractionFailed = false;
  let extraction: { status: "disabled" } | { status: "completed"; saved: number; evidenceFailures: number; errors: number } = { status: "disabled" };
  if (process.env.PIPELINE_MODEL_ENABLED === "true") {
    const modelName = process.env.PIPELINE_MODEL_NAME?.trim();
    if (!modelName) {
      return json({ ok: false, stage: "extraction", error: "PIPELINE_MODEL_NAME is required" }, 500);
    }
    const modelReport = await runExtractionBatch({
      store: new SupabaseExtractionStore(db),
      model: createOpenAiCompatibleExtractionModel({
        model: modelName,
        baseUrl: process.env.PIPELINE_MODEL_BASE_URL ?? "http://127.0.0.1:20128/v1",
        apiKey: process.env.PIPELINE_MODEL_API_KEY,
        allowRemote: process.env.PIPELINE_ALLOW_REMOTE_MODEL === "true",
      }),
      limit,
    });
    extraction = {
      status: "completed",
      saved: modelReport.saved,
      evidenceFailures: modelReport.evidenceFailures,
      errors: modelReport.errors.length,
    };
    extractionFailed = modelReport.errors.length > 0;
  }
  let sheetSyncFailed = false;
  let sheetSync:
    | { status: "disabled" }
    | { status: "completed"; appended: number; refreshed: number; linked: number; alreadyPresent: number; archived: number }
    | { status: "failed"; error: string } = { status: "disabled" };

  if (googleSheetsConfigured()) {
    try {
      const report = await syncReviewQueueToGoogleSheet({ db, limit });
      sheetSync = {
        status: "completed",
        appended: report.appended,
        refreshed: report.refreshed,
        linked: report.linked,
        alreadyPresent: report.alreadyPresent,
        archived: report.archived,
      };
    } catch (error) {
      sheetSyncFailed = true;
      sheetSync = {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Unknown Sheet sync failure",
      };
    }
  }

  const response = {
    ok: failed.length === 0 && !discoveryFailed && !extractionFailed && !sheetSyncFailed,
    scheduled: Array.isArray(scheduled) ? scheduled.length : 0,
    claimed: reports.length,
    completed: reports.length - failed.length,
    failed: failed.length,
    recordsSeen: reports.reduce((sum, report) => sum + report.recordsSeen, 0),
    recordsArchived: reports.reduce((sum, report) => sum + report.recordsArchived, 0),
    reviewTasksCreated: reports.reduce((sum, report) => sum + report.reviewTasksCreated, 0),
    discovery,
    extraction,
    sheetSync,
    reports,
  };
  return json(response, failed.length || discoveryFailed || extractionFailed || sheetSyncFailed ? 500 : 200);
}
