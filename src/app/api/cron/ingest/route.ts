import { NextResponse } from 'next/server';

import { authorizeCronRequest } from '@/lib/cron/auth';
import { runPipelineCycle } from '@/lib/pipeline-cycle';
import { createPipelineServiceClient } from '@/lib/pipeline/store-supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: Request) {
  if (!authorizeCronRequest(request.headers.get('authorization'))) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') {
    return json({ ok: false, error: 'production_only' }, 403);
  }

  const db = createPipelineServiceClient();
  const report = await runPipelineCycle({
    db,
    storage: db.storage,
    trigger: 'cron',
  });

  return json({
    ok: report.status === 'completed',
    ...report,
  }, report.status === 'completed' ? 200 : 500);
}
