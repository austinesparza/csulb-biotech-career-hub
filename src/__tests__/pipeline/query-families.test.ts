/**
 * Query strategy: do restrictive year, degree or science terms create false
 * negatives on the fixed evaluation set? Boolean reachability on indexable
 * titles is an upper bound on retrieval, so a query that cannot match here
 * cannot retrieve the role at all.
 */
import { loadTaxonomy } from '../../lib/pipeline/classify';
import { EVAL_CASES, indexDocs, queryMatches } from '../../lib/pipeline/eval/verification-eval';
import { legacyEmployerSearchPlan, legacyLaneSearchPlans } from '../../lib/pipeline/eval/legacy-query-plans';
import { QUERY_LIMITS, employerQueryFamilies, methodQueryFamilies, registryEmployers, tenantHostsFor, withinLimits } from '../../lib/pipeline/query-families';
import { buildEmployerSearchPlan, buildLaneSearchPlans } from '../../lib/pipeline/search-plan';

let passed = 0;
let failed = 0;
function ok(name: string, assertion: boolean, detail: unknown = ''): void {
  console.log(`${assertion ? 'PASS' : 'FAIL'} ${name}${assertion ? '' : `  -> ${JSON.stringify(detail)}`}`);
  assertion ? passed++ : failed++;
}

const doc = (url: string, text: string) => ({ url, text });
ok('matcher: OR binds neighbours and other terms are required',
  queryMatches('"Gilead" intern OR co-op', doc('https://x.com/a', 'Gilead Sciences Research Co-op'))
  && !queryMatches('"Gilead" intern OR co-op', doc('https://x.com/a', 'Gilead Sciences Scientist')));
ok('matcher: site: restricts host and path', queryMatches('site:linkedin.com/jobs/view intern', doc('https://www.linkedin.com/jobs/view/1', 'intern'))
  && !queryMatches('site:linkedin.com/posts intern', doc('https://www.linkedin.com/jobs/view/1', 'intern')));
ok('matcher: quoted stems do not match whole words ("oncolog" vs oncology)',
  !queryMatches('"oncolog" intern', doc('https://x.com', 'Oncology Intern')) && queryMatches('"oncology" intern', doc('https://x.com', 'Oncology Intern')));

const taxonomy = loadTaxonomy();
const titleDocs = EVAL_CASES.filter((row) => row.identifiable).map((row) => ({ row, docs: indexDocs(row) }));
const reach = (queries: string[]) => titleDocs.filter(({ docs }) => queries.some((query) => docs.some((item) => queryMatches(query, item)))).length;

const legacyLanes = legacyLaneSearchPlans(taxonomy, 2027).flatMap((plan) => plan.queries.map((query) => query.query));
const legacyRestrictive = legacyLaneSearchPlans(taxonomy, 2027).map((plan) => plan.queries[1].query);
const newLanes = buildLaneSearchPlans(taxonomy, 2027).flatMap((plan) => plan.queries.map((query) => query.query));
const restrictiveReach = reach(legacyRestrictive);
const legacyReach = reach(legacyLanes);
const newReach = reach(newLanes);
console.log(`lane reach on ${titleDocs.length} identifiable roles: restrictive arm ${restrictiveReach}, legacy lanes ${legacyReach}, new lanes ${newReach}`);
ok('the legacy year+degree+science lane arm reaches almost none of the evaluation roles', restrictiveReach <= 2, restrictiveReach);
ok('recall-first method families reach more roles without employer names than the legacy lanes', newReach > legacyReach, { legacyReach, newReach });

const palm = EVAL_CASES.find((row) => row.id === 'S18')!;
const fredHutch = EVAL_CASES.find((row) => row.id === 'S12')!;
ok('an unexpected-title role (PALM and AI co-op) is unreachable by any legacy lane query',
  !legacyLanes.some((query) => indexDocs(palm).some((item) => queryMatches(query, item))));
ok('it is reachable by the new J&J tenant arm, which needs no science or year term',
  buildEmployerSearchPlan({ employer: 'Johnson & Johnson', cycleYear: 2027, careersDomain: tenantHostsFor('Johnson & Johnson')[0] })
    .queries.some((query) => indexDocs(palm).some((item) => queryMatches(query.query, item))));
ok('a generic title (Research Intern, Temporary) is unreachable by every legacy lane query',
  !legacyLanes.some((query) => indexDocs(fredHutch).some((item) => queryMatches(query, item))));
const legacyJnj = legacyEmployerSearchPlan({ employer: 'Johnson & Johnson', cycleYear: 2027, careersDomain: 'www.careers.jnj.com' }).queries;
ok('legacy employer arms require an eligibility phrase in one arm; the new recall arms never do',
  legacyJnj.some((query) => /currently enrolled/.test(query.query))
  && employerQueryFamilies({ employer: 'Johnson & Johnson' }).filter((query) => !query.restrictive).every((query) => !/enrolled|master's|graduate|2027|summer/i.test(query.query)));

ok('every generated query fits conservative provider limits and uses no parentheses', [
  ...registryEmployers().flatMap((employer) => employerQueryFamilies({ employer, graduateArm: true })),
  ...methodQueryFamilies({ term: 'long-read sequencing', lane: 'genomics', atsHost: 'myworkdayjobs.com' }),
].every((query) => withinLimits(query.query) && !query.query.includes('(')), QUERY_LIMITS);
ok('LinkedIn job pages and employer hiring posts remain discovery arms', employerQueryFamilies({ employer: 'Vertex' })
  .filter((query) => query.route === 'linkedin_lead').map((query) => query.family).sort().join(',') === 'linkedin_jobs,linkedin_posts');
ok('restrictive graduate terms are an opt-in precision arm', !employerQueryFamilies({ employer: 'Vertex' }).some((query) => query.restrictive)
  && employerQueryFamilies({ employer: 'Vertex', graduateArm: true }).filter((query) => query.restrictive).length === 1);
ok('shared hosts keep the employer name; single-employer tenants do not need it',
  employerQueryFamilies({ employer: 'Nanopath' }).some((query) => query.query.startsWith('site:job-boards.greenhouse.io "Nanopath"'))
  && employerQueryFamilies({ employer: 'Elanco' }).some((query) => query.query === 'site:elanco.wd5.myworkdayjobs.com intern OR interns OR internship OR co-op'));
ok('operating companies map to the parent recruiting tenant (Kite -> Gilead Yello/Workday)',
  tenantHostsFor('Kite Pharma').includes('gilead.yello.co'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
