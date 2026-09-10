import { NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/cron/auth";
import { createPipelineServiceClient } from "@/lib/pipeline/store-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ ok: false, error: "production_only" }, { status: 403 });
  }

  const db = createPipelineServiceClient();
  const { data, error } = await db.rpc("queue_pipeline_health_tasks");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const summary = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(
    { ok: true, sourceHealthTasks: summary?.source_health_tasks ?? 0, staleRecordTasks: summary?.stale_record_tasks ?? 0 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
