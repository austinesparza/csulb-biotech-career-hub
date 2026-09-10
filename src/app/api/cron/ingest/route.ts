import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/cron/auth";
import { runIngestionBatch } from "@/lib/ingestion/source-runner";
import { runExtractionBatch } from "@/lib/pipeline/extraction-runner";
import { createOpenAiCompatibleExtractionModel } from "@/lib/pipeline/model-openai";
import { createPipelineServiceClient, SupabaseExtractionStore } from "@/lib/pipeline/store-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false, error: "production_only" }, { status: 403 });
  }

  const db = createPipelineServiceClient();
  const requestedLimit = Number(process.env.PIPELINE_BATCH_LIMIT ?? 5);
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 10)) : 5;
  const { data: scheduled, error: scheduleError } = await db.rpc("schedule_due_source_fetch_runs", {
    p_limit: limit,
  });
  if (scheduleError) {
    return NextResponse.json({ ok: false, stage: "schedule", error: scheduleError.message }, { status: 500 });
  }

  const reports = await runIngestionBatch({
    db,
    storage: db.storage,
    workerId: `vercel-cron:${randomUUID()}`,
    limit,
  });
  const failed = reports.filter((report) => report.status === "failed");
  let extractionFailed = false;
  let extraction: { status: "disabled" } | { status: "completed"; saved: number; evidenceFailures: number; errors: number } = { status: "disabled" };
  if (process.env.PIPELINE_MODEL_ENABLED === "true") {
    const modelName = process.env.PIPELINE_MODEL_NAME?.trim();
    if (!modelName) {
      return NextResponse.json({ ok: false, stage: "extraction", error: "PIPELINE_MODEL_NAME is required" }, { status: 500 });
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
  const response = {
    ok: failed.length === 0 && !extractionFailed,
    scheduled: Array.isArray(scheduled) ? scheduled.length : 0,
    claimed: reports.length,
    completed: reports.length - failed.length,
    failed: failed.length,
    recordsSeen: reports.reduce((sum, report) => sum + report.recordsSeen, 0),
    recordsArchived: reports.reduce((sum, report) => sum + report.recordsArchived, 0),
    reviewTasksCreated: reports.reduce((sum, report) => sum + report.reviewTasksCreated, 0),
    extraction,
    reports,
  };
  return NextResponse.json(response, {
    status: failed.length || extractionFailed ? 500 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
