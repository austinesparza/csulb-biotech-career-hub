import { createBraveSearchProvider } from '../../lib/pipeline/brave-search';
import { discoveryOffsetForDate, runEmployerDiscoveryBatch, runLaneDiscoveryBatch } from '../../lib/pipeline/discovery-runner';
import { archiveDiscoveryLead, type DiscoveryLeadObservation } from '../../lib/pipeline/lead-store-supabase';

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${detail}`}`);
};

let storageRightsRejected = false;
try {
  createBraveSearchProvider({ apiKey: 'fixture-key', storageRightsConfirmed: false });
} catch (error) {
  storageRightsRejected = error instanceof Error && error.message.includes('storage rights');
}
ok('search provider requires explicit result-storage rights', storageRightsRejected);

let calledUrl = '';
let calledInit: RequestInit | undefined;
const fetchImpl: typeof fetch = async (input, init) => {
  calledUrl = String(input);
  calledInit = init;
  return new Response(JSON.stringify({
    web: { results: [{
      url: 'https://jobs.ashbyhq.com/example/123',
      title: '<strong>Genomics</strong> Intern',
      description: '<p>Graduate internship</p>',
    }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const brave = createBraveSearchProvider({ apiKey: 'fixture-key', storageRightsConfirmed: true, fetchImpl });
const braveResults = await brave.search('"Example Bio" internship', 5);
ok('provider uses only the fixed Brave endpoint', calledUrl.startsWith('https://api.search.brave.com/res/v1/web/search?'));
ok('provider sends its credential only in the required header',
  (calledInit?.headers as Record<string, string>)['X-Subscription-Token'] === 'fixture-key' && calledInit?.redirect === 'error');
ok('provider strips markup from bounded result fields',
  braveResults[0]?.title === 'Genomics Intern' && braveResults[0]?.snippet === 'Graduate internship');

const employerRpcCalls: Array<Record<string, unknown>> = [];
const employerDb = { rpc: async (_name: string, args: Record<string, unknown>) => {
  employerRpcCalls.push(args);
  return { data: `lead-${employerRpcCalls.length}`, error: null };
} };
const employerProvider = {
  name: 'fixture-search',
  async search(query: string) {
    return [{
      url: query.includes('linkedin.com')
        ? 'https://www.linkedin.com/jobs/view/123'
        : 'https://jobs.ashbyhq.com/example/123',
      title: 'Graduate Genomics Intern', snippet: 'A public search snippet', rank: 1,
    }];
  },
};
const employerReport = await runEmployerDiscoveryBatch({
  db: employerDb as never,
  provider: employerProvider,
  now: new Date('2026-09-11T12:00:00Z'),
  cycleYear: 2027,
  employerLimit: 1,
  resultsPerQuery: 1,
  offset: 0,
  runId: 'fixture-run',
});
ok('employer discovery archives every returned result without publishing',
  employerReport.employers === 1 && employerReport.lanes === 0 && employerReport.archived === 5
    && employerRpcCalls.every((call) => !('p_public_safe' in call) && !('p_review_status' in call)));
ok('observed URLs have stable cross-query lead identities',
  new Set(employerRpcCalls
    .filter((call) => call.p_original_url === 'https://jobs.ashbyhq.com/example/123')
    .map((call) => call.p_lead_key)).size === 1);
ok('search snippets receive advisory classification without being filtered',
  employerRpcCalls.length === 5 && employerRpcCalls.every((call) => {
    const metadata = call.p_raw_metadata as Record<string, unknown>;
    const triage = metadata.snippetTriage as Record<string, unknown>;
    return triage?.advisoryOnly === true && typeof triage.score === 'number';
  }));
ok('LinkedIn remains a private lead rather than publication evidence',
  employerRpcCalls.some((call) => call.p_resolution === 'linkedin_only'));

const firstOffset = discoveryOffsetForDate(new Date('2026-09-11T12:00:00Z'), 5);
const nextOffset = discoveryOffsetForDate(new Date('2026-09-12T12:00:00Z'), 5);
ok('daily rotation advances by one complete employer cohort', nextOffset - firstOffset === 5);

const workdayCalls: Array<Record<string, unknown>> = [];
await runEmployerDiscoveryBatch({
  db: { rpc: async (_name: string, args: Record<string, unknown>) => {
    workdayCalls.push(args);
    return { data: `lead-${workdayCalls.length}`, error: null };
  } } as never,
  provider: {
    name: 'fixture-search',
    async search() {
      return [{
        url: 'https://gilead.wd1.myworkdayjobs.com/gileadcareers/job/Intern-R-D_R0050000',
        title: 'Research Intern', snippet: null, rank: 1,
      }];
    },
  },
  now: new Date('2026-09-12T12:00:00Z'),
  employerLimit: 1,
  resultsPerQuery: 1,
  offset: 0,
  runId: 'workday-fixture',
});
ok('Workday results are recognized as official-source candidates',
  workdayCalls.length === 5 && workdayCalls.every((call) => call.p_resolution === 'official_source_found'));

const laneCalls: Array<Record<string, unknown>> = [];
const laneReport = await runLaneDiscoveryBatch({
  db: { rpc: async (_name: string, args: Record<string, unknown>) => {
    laneCalls.push(args);
    return { data: `lead-${laneCalls.length}`, error: null };
  } } as never,
  provider: {
    name: 'fixture-search',
    async search() {
      return [{
        url: 'https://jobs.jobvite.com/example/job/123',
        title: 'Research Intern', snippet: 'Public posting snippet', rank: 1,
      }];
    },
  },
  taxonomy: {
    version: 1,
    lanes: [{ id: 'genomics', label: 'Genomics', core: ['genomics'] }],
    biological_context: [], functions: [], methods: {},
    opportunity_types: { in_scope: [], adjacent: [] }, graduate_stage: [],
    structural_gates: [], personal_gates: {}, exclude_titles: [],
  } as never,
  now: new Date('2026-09-12T12:00:00Z'),
  laneLimit: 1,
  resultsPerQuery: 1,
  offset: 0,
  runId: 'lane-fixture',
});
ok('bounded lane discovery executes one lane and its five query families',
  laneReport.lanes === 1 && laneReport.queries === 5 && laneReport.archived === 5);
ok('lane discovery retains lane and official ATS provenance',
  laneCalls.every((call) => call.p_lane === 'genomics'
    && call.p_route === 'official_feed'
    && call.p_resolution === 'official_source_found'));

const stableCalls: Array<Record<string, unknown>> = [];
const stableDb = { rpc: async (_name: string, args: Record<string, unknown>) => {
  stableCalls.push(args);
  return { data: 'lead-id', error: null };
} };
const base: DiscoveryLeadObservation = {
  runId: 'stable-run', route: 'web_search', query: 'internship', lane: null,
  originalUrl: 'https://example.org/jobs/1', normalizedUrl: 'https://example.org/jobs/1',
  visibleTitle: 'Intern', visibleSnippet: null, employerHint: 'Example', originalReachable: true,
  resolution: 'unresolved', canonicalEmployerUrl: null, archiveReason: 'Retained for review.',
  rawMetadata: {}, retrievedAt: '2026-09-11T12:00:00Z',
};
await archiveDiscoveryLead(stableDb as never, base);
await archiveDiscoveryLead(stableDb as never, { ...base, retrievedAt: '2026-09-11T13:00:00Z' });
ok('retrying a bounded run reuses its observation key',
  stableCalls[0].p_observation_key === stableCalls[1].p_observation_key);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
