import { NextResponse } from 'next/server';

import { runPipelineCycle } from '@/lib/pipeline-cycle';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function sourcesUrl(request: Request, params: Record<string, string>): URL {
  const url = new URL('/admin/sources', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function POST(request: Request) {
  try {
    await requireOfficer();
    const db = createServiceClient();
    const report = await runPipelineCycle({
      db,
      storage: db.storage,
      trigger: 'officer',
    });

    return NextResponse.redirect(sourcesUrl(request, {
      operation: 'pipeline',
      outcome: report.status,
      ...(report.cycleId ? { cycle: report.cycleId } : {}),
    }), 303);
  } catch (error) {
    console.error('[pipeline-cycle] operator route failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return NextResponse.redirect(sourcesUrl(request, {
      operation: 'pipeline',
      outcome: 'error',
    }), 303);
  }
}
