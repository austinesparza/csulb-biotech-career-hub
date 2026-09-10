import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/cron/auth";
import { createPipelineServiceClient } from "@/lib/pipeline/store-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const { data, error } = await db.rpc("queue_pipeline_health_tasks");
  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }
  const summary = Array.isArray(data) ? data[0] : data;
  return json({ ok: true, sourceHealthTasks: summary?.source_health_tasks ?? 0, staleRecordTasks: summary?.stale_record_tasks ?? 0 });
}
