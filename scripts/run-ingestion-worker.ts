import os from "node:os";

import { runIngestionBatch } from "../src/lib/ingestion/source-runner";
import { createPipelineServiceClient } from "../src/lib/pipeline/store-supabase";

const db = createPipelineServiceClient();
const workerId = process.env.PIPELINE_WORKER_ID?.trim() || `${os.hostname()}:${process.pid}`;
const limit = Number(process.env.PIPELINE_BATCH_LIMIT ?? 5);
const reports = await runIngestionBatch({ db, storage: db.storage, workerId, limit });
console.log(JSON.stringify({ claimed: reports.length, reports }));
if (reports.some((report) => report.status === "failed")) process.exitCode = 1;
