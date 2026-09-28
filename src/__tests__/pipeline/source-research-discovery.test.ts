import { postingRequisitionId, researchCandidateScore, runSourceResearchDiscoveryBatch } from '../../lib/pipeline/source-research-discovery';

let passed = 0;
let failed = 0;
function ok(name: string, assertion: boolean): void {
  console.log(`${assertion ? 'PASS' : 'FAIL'} ${name}`);
  assertion ? passed++ : failed++;
}

const target = { url: 'https://boards.greenhouse.io/keros/jobs/1234567',
  title: 'Protein Biochemistry Intern - Keros Therapeutics', snippet: 'Keros career programs', rank: 1 };
const input = { result: target, company: 'Keros Therapeutics', title: 'Protein Biochemistry Intern', careersDomain: null };
ok('a role-specific ATS hit is a research candidate', researchCandidateScore(input) > 0);
ok('a generic ATS careers page is not a requisition', researchCandidateScore({
  ...input, result: { ...target, url: 'https://boards.greenhouse.io/keros/jobs' },
}) === 0);
ok('a mismatched title does not attach to research', researchCandidateScore({
  ...input, result: { ...target, title: 'Summer Finance Intern - Keros Therapeutics' },
}) === 0);
ok('a lookalike ATS hostname does not qualify', researchCandidateScore({
  ...input, result: { ...target, url: 'https://boards.greenhouse.io.bad-domain.org/keros/jobs/1234567' },
}) === 0);
ok('a LinkedIn search index hit is not an employer posting', researchCandidateScore({
  ...input, result: { ...target, url: 'https://www.linkedin.com/jobs/view/1234567' },
}) === 0);
ok('requisition keys survive Greenhouse trailing-slash and Workday locale changes',
  postingRequisitionId('https://boards.greenhouse.io/keros/jobs/1234567/') === '1234567'
  && postingRequisitionId('https://gilead.wd1.myworkdayjobs.com/en-US/jobs/job/Intern_R0050000') === 'R0050000');

const rows = [
  { id: 'research-1', payload: { intake_stage: 'source_research', company: 'Keros Therapeutics', title: 'Protein Biochemistry Intern' } },
  { id: 'research-2', payload: { intake_stage: 'source_research', company: 'Keros Therapeutics', title: 'Protein Biochemistry Intern' } },
];
const archives: Array<Record<string, unknown>> = [];
const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
const db = {
  from(table: string) {
    if (table === 'user_submissions') {
      let payload: Record<string, unknown> | null = null;
      let id = '';
      const query = {
        select() { return query; },
        order() { return query; },
        limit() { return Promise.resolve({ data: payload ? [{ id }] : rows, error: null }); },
        update(value: { payload: Record<string, unknown> }) { payload = value.payload; return query; },
        eq(column: string, value: string) {
          if (column === 'id') id = value;
          if (column === 'payload' && JSON.stringify(rows.find((row) => row.id === id)?.payload) !== value) {
            throw new Error('concurrent update comparator was not the original payload');
          }
          return query;
        },
        then(resolve: (value: unknown) => unknown) {
          updates.push({ id, payload: payload ?? {} });
          return Promise.resolve({ data: [{ id }], error: null }).then(resolve);
        },
      };
      return query;
    }
    if (table === 'opportunities' || table === 'source_postings') {
      const query = { select() { return query; }, eq() { return query; }, in() { return query; }, ilike() { return query; },
        limit() { return Promise.resolve({ data: [], error: null }); } };
      return query;
    }
    throw new Error(`unexpected table ${table}`);
  },
  async rpc(_name: string, args: Record<string, unknown>) {
    archives.push(args);
    return { data: `lead-${archives.length}`, error: null };
  },
};
const report = await runSourceResearchDiscoveryBatch({
  db: db as never, provider: {
    name: 'fixture', async search() { return [target, {
      url: 'https://www.linkedin.com/jobs/view/98765', title: target.title, snippet: null, rank: 2,
    }]; },
  },
  now: new Date('2026-09-26T12:00:00Z'), limit: 2, resultsPerQuery: 2,
});
ok('the bounded job searches both exact-role query variants', report.searched === 2 && report.queries === 4);
ok('both submissions retain the candidate but only one requests a new task',
  report.candidateLinks === 2 && report.existingMatches === 1 && updates.length === 2
  && updates.every((row) => row.payload.posting_status === 'unknown' && row.payload.msc_eligibility === 'unknown')
  && archives.filter((item) => (item.p_raw_metadata as Record<string, unknown>).reviewCandidate === true).length === 2);
ok('index observations cannot establish an official source or a live page', archives.every((item) =>
  item.p_resolution !== 'official_source_found' && item.p_original_reachable === false && item.p_canonical_employer_url === null));
ok('search results are archived with a private research record ID', report.archived === 8
  && archives.every((item) => typeof (item.p_raw_metadata as Record<string, unknown>).researchSubmissionId === 'string'));

const existingArchives: Array<Record<string, unknown>> = [];
let existingPayload: Record<string, unknown> | null = null;
const duplicateDb = {
  from(table: string) {
    if (table === 'user_submissions') {
      const query = {
        select() { return query; }, order() { return query; }, eq() { return query; },
        limit() { return Promise.resolve({ data: existingPayload ? [{ id: 'research-3' }] : [rows[0]], error: null }); },
        update(input: { payload: Record<string, unknown> }) { existingPayload = input.payload; return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [{ id: 'research-3' }], error: null }).then(resolve); },
      };
      return query;
    }
    const query = { select() { return query; }, eq() { return query; }, in() { return query; }, ilike() { return query; },
      limit() { return Promise.resolve({ data: table === 'opportunities' ? [{ id: 'existing-opportunity', posting_url: target.url }] : [], error: null }); } };
    return query;
  },
  async rpc(_name: string, args: Record<string, unknown>) {
    existingArchives.push(args);
    return { data: 'existing-lead', error: null };
  },
};
const duplicateReport = await runSourceResearchDiscoveryBatch({
  db: duplicateDb as never, provider: { name: 'fixture', async search() { return [target]; } },
  now: new Date('2026-09-26T12:00:00Z'), limit: 1,
});
const savedDuplicatePayload = existingPayload as Record<string, unknown> | null;
ok('an existing opportunity is linked without another review task or draft', duplicateReport.existingMatches === 1
  && savedDuplicatePayload?.existing_opportunity_id === 'existing-opportunity'
  && savedDuplicatePayload?.role_url_status === 'existing_record_match'
  && existingArchives.every((item) => (item.p_raw_metadata as Record<string, unknown>).reviewCandidate === false));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
