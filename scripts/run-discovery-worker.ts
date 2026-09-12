import { createBraveSearchProvider } from '../src/lib/pipeline/brave-search';
import { runEmployerDiscoveryBatch } from '../src/lib/pipeline/discovery-runner';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is required');
const provider = createBraveSearchProvider({
  apiKey,
  storageRightsConfirmed: process.env.BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED === 'true',
});
const report = await runEmployerDiscoveryBatch({
  db: createPipelineServiceClient(),
  provider,
  employerLimit: positiveInteger('EMPLOYER_DISCOVERY_BATCH_SIZE', 1, 5),
  resultsPerQuery: positiveInteger('EMPLOYER_DISCOVERY_RESULTS_PER_QUERY', 5, 10),
});
console.log(JSON.stringify(report));
if (report.errors.length > 0) process.exitCode = 1;
