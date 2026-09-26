import { runPostingVerificationBatch } from '../src/lib/pipeline/verification-runner';
import { createScraplingClient } from '../src/lib/pipeline/scraping-clients';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

// Bounded manual run of the official-posting verification loop.
// VERIFICATION_DRY_RUN=true fetches only governed pages and writes nothing.
function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  return value;
}

const db = createPipelineServiceClient();
const report = await runPostingVerificationBatch({
  db,
  storage: db.storage,
  limit: positiveInteger('POSTING_VERIFICATION_BATCH_SIZE', 5, 20),
  dryRun: process.env.VERIFICATION_DRY_RUN === 'true',
  scrapling: process.env.PIPELINE_SCRAPLING_ENABLED === 'true' ? createScraplingClient() : null,
});
console.log(JSON.stringify(report, null, 2));
if (report.errors.length > 0) process.exitCode = 1;
