import os from 'node:os';

import { runPipelineCycle } from '../src/lib/pipeline-cycle';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

const db = createPipelineServiceClient();
const runId = process.env.GITHUB_RUN_ID?.trim();
const workerId = process.env.PIPELINE_WORKER_ID?.trim()
  || `github-actions:${runId || os.hostname()}:${process.pid}`;

const report = await runPipelineCycle({
  db,
  storage: db.storage,
  trigger: 'cron',
  workerId,
});

console.log(JSON.stringify({
  status: report.status,
  cycleId: report.cycleId,
  scheduled: report.scheduled,
  recovered: report.recovered,
  claimed: report.claimed,
  completed: report.completed,
  partial: report.partial,
  failed: report.failed,
  recordsSeen: report.recordsSeen,
  recordsArchived: report.recordsArchived,
  reviewTasksCreated: report.reviewTasksCreated,
  reconciliation: report.reconciliation,
  discovery: report.discovery,
  extraction: report.extraction,
  sheetSync: report.sheetSync,
  errors: report.errors,
}));

if (report.status !== 'completed') process.exitCode = 1;
