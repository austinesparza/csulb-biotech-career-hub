import fs from 'node:fs';
import {
  measureDiscoveryRecall,
  type DiscoveryRecallExpectation,
  type DiscoveryRecallObservation,
} from '../src/lib/pipeline/discovery-recall';
import { createPipelineServiceClient } from '../src/lib/pipeline/store-supabase';

const fixturePath = process.env.DISCOVERY_RECALL_FIXTURE_PATH?.trim();
if (!fixturePath) {
  throw new Error('DISCOVERY_RECALL_FIXTURE_PATH must point to a local, private recall JSON file');
}
const benchmark = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
  _meta?: { observedAt?: string };
  expectations?: DiscoveryRecallExpectation[];
};
if (!Array.isArray(benchmark.expectations)) {
  throw new Error('Recall fixture must contain an expectations array');
}

const db = createPipelineServiceClient();
const { data, error } = await db
  .from('discovery_leads')
  .select('original_url, latest_title, employer_hint')
  .order('last_seen_at', { ascending: false })
  .limit(5_000);
if (error) throw new Error(`load discovery recall observations: ${error.message}`);

const observations = (data ?? []).map((row): DiscoveryRecallObservation => ({
  originalUrl: row.original_url,
  title: row.latest_title,
  employer: row.employer_hint,
}));
const report = measureDiscoveryRecall(
  benchmark.expectations,
  observations,
);
const missing = report.matches
  .filter((match) => !match.observation)
  .map((match) => ({ id: match.expectation.id, employer: match.expectation.employer, title: match.expectation.title }));

console.log(JSON.stringify({
  benchmarkObservedAt: benchmark._meta?.observedAt ?? null,
  expected: report.expected,
  recovered: report.recovered,
  recall: Number(report.recall.toFixed(4)),
  missing,
}, null, 2));
