/**
 * Official-posting verification: identity, page state, gates, duplicates,
 * governance and the runner boundary. Page bodies are synthetic fixtures that
 * reproduce vendor shapes; they are not captured employer pages.
 */
import { resolvePostingIdentity, attributeEmployer } from '../../lib/pipeline/posting-identity';
import { assessFetchedPage, compareTitles, extractGates, pageText, sameRequisition, type FetchedPage } from '../../lib/pipeline/posting-evidence';
import { decideDuplicate, decideVerification, type ExistingRecord } from '../../lib/pipeline/posting-verification';
import { buildVerificationScope, governVerification, redactContacts, runPostingVerificationBatch, type VerificationSourceRow } from '../../lib/pipeline/verification-runner';

let passed = 0;
let failed = 0;
function ok(name: string, assertion: boolean, detail: unknown = ''): void {
  console.log(`${assertion ? 'PASS' : 'FAIL'} ${name}${assertion ? '' : `  -> ${JSON.stringify(detail)}`}`);
  assertion ? passed++ : failed++;
}

const AT = '2026-09-26T16:00:00.000Z';
function page(url: string, body: string | null, status = 200, extra: Partial<FetchedPage> = {}): FetchedPage {
  return { requestedUrl: url, finalUrl: url, status, body, contentType: 'text/html', redirects: [], retrievedAt: AT, ...extra };
}
function html(title: string, paragraphs: string[], apply = true): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main><h1>${title}</h1>`
    + paragraphs.map((p) => `<p>${p}</p>`).join('')
    + (apply ? '<a class="btn apply" href="/apply">Apply now</a>' : '')
    + '<footer>Equal opportunity employer. We consider all qualified applicants without regard to protected status. Learn about our benefits, culture and hiring process on our careers site.</footer>'
    + '</main></body></html>';
}

const JNJ = 'https://www.careers.jnj.com/en/jobs/r-099898/oncology-discovery-scientist-intern/';
const jnjBody = html('Oncology Discovery Scientist Intern', [
  'Requisition ID: R-099898',
  'Johnson &amp; Johnson Innovative Medicine is recruiting for an Oncology Discovery Scientist Intern located in Spring House, PA for Summer 2027.',
  'Candidates must be enrolled in a Master\'s or PhD program in biology, genomics or a related field and remain enrolled throughout the internship.',
  'Candidates must be permanently authorized to work in the United States and must not require sponsorship now or in the future.',
  'This job posting is anticipated to close on November 3, 2026. The Company may however extend this time-period.',
  'Contact our recruiter at talent.person@its.jnj.com or 555-123-4567 with questions.',
]);

console.log('=== Identity and tenant attribution ===');
{
  const danaher = resolvePostingIdentity('https://danaher.wd1.myworkdayjobs.com/en-US/DanaherJobs/job/Research---Development-Graduate-Intern_R1316744');
  ok('a Danaher Workday URL is a shared parent tenant, not Aldevron by hostname',
    attributeEmployer({ leadEmployer: 'Aldevron', identity: danaher }).status === 'needs_page_evidence');
  ok('the parent tenant is accepted only when the employer page names the operating company',
    attributeEmployer({ leadEmployer: 'Aldevron', identity: danaher, pageText: 'Aldevron is hiring an R&D Graduate Intern in Waltham.' }).status === 'operating_company_confirmed');
  const ibri = resolvePostingIdentity('https://indiana-biosciences-research-institute-inc.prismhr-hire.com/job/1053098/biology-research-intern-2027');
  ok('a lookalike title from a different employer tenant is an attribution mismatch (Libris vs IBRI)',
    attributeEmployer({ leadEmployer: 'Libris Innovations', identity: ibri }).status === 'mismatch');
  ok('a lookalike Greenhouse hostname is not an ATS posting',
    resolvePostingIdentity('https://boards.greenhouse.io.bad-domain.org/keros/jobs/1234567').system === 'employer_site'
    && resolvePostingIdentity('https://boards.greenhouse.io.bad-domain.org/keros/jobs/1234567').tenant === null);
  const genentechOnRoche = resolvePostingIdentity('https://roche.wd3.myworkdayjobs.com/roche-ext/job/Indianapolis/Intern_202608-121913');
  ok('Genentech is not assumed from the Roche Diagnostics Workday site',
    attributeEmployer({ leadEmployer: 'Genentech', identity: genentechOnRoche }).status === 'mismatch');
  ok('an unregistered tenant needs page evidence of the employer',
    attributeEmployer({ leadEmployer: 'Keros Therapeutics', identity: resolvePostingIdentity('https://job-boards.greenhouse.io/unknownboard/jobs/4728738005') }).status === 'needs_page_evidence');
  ok('ORISE program host never attributes FDA from the hostname',
    attributeEmployer({ leadEmployer: 'FDA', identity: resolvePostingIdentity('https://www.zintellect.com/Opportunity/Details/FDA-CDRH-2026-0008') }).status === 'needs_page_evidence');
  ok('board, search and landing pages are not requisitions', [
    'https://job-boards.greenhouse.io/nanopathinc', 'https://jobs.sanofi.com/en/search_jobs',
    'https://www.waypointbio.com/careers', 'https://jobs.danaher.com/global/en/danaher-internship-program',
    'https://roche.wd3.myworkdayjobs.com/roche-ext',
  ].every((url) => !resolvePostingIdentity(url).detailPage));
  ok('Workday requisitions with hyphens and re-post suffixes are parsed', [
    ['https://vrtx.wd501.myworkdayjobs.com/en-US/Vertex_Careers/job/Vertex-Spring-Co-Op-2027--Long-Read-Sequencing_REQ-30507-1', 'REQ-30507'],
    ['https://roche.wd3.myworkdayjobs.com/roche-ext/job/Indianapolis/XMLNAME-2027-Summer-Intern_202608-121913', '202608-121913'],
    ['https://elanco.wd5.myworkdayjobs.com/External_Career/job/Clinton-IN/Technical-Services-Intern_R0026869-1', 'R0026869'],
    ['https://alcon.wd5.myworkdayjobs.com/en-US/careers_alcon/job/XMLNAME-2027-Chemistry_R-2026-49482', 'R-2026-49482'],
  ].every(([url, req]) => resolvePostingIdentity(url).requisitionId === req));
  const multi = [
    'https://roche.wd3.myworkdayjobs.com/roche-ext/job/Indianapolis/QR-E-Intern_202608-121913',
    'https://roche.wd3.myworkdayjobs.com/en-US/roche-ext/job/Tucson/QR-E-Intern_202608-121913',
  ].map((url) => resolvePostingIdentity(url).identityKey);
  ok('one multi-location requisition has one identity across location paths and locales', multi[0] !== null && multi[0] === multi[1]);
  ok('J&J locale variants share one identity', resolvePostingIdentity(JNJ).identityKey
    === resolvePostingIdentity('https://www.careers.jnj.com/es-la/jobs/r-099898/oncology-discovery-scientist-intern').identityKey);
}

console.log('=== Page state: 200 is never open by itself ===');
{
  const expected = resolvePostingIdentity(JNJ);
  const open = assessFetchedPage({ page: page(JNJ, jnjBody), expected });
  ok('an employer page with Apply, matching requisition and no closure is apply_visible', open.state === 'apply_visible', open.reason);
  const noApply = assessFetchedPage({ page: page(JNJ, html('Oncology Discovery Scientist Intern', ['Requisition ID: R-099898', 'A long description of the internship programme and its scientific scope across oncology discovery, genomics and translational research teams.'], false)), expected });
  ok('a readable 200 page with no Apply control is ambiguous, not open', noApply.state === 'ambiguous', noApply.state);
  const closed = assessFetchedPage({ page: page(JNJ, html('Oncology Discovery Scientist Intern', ['Requisition ID: R-099898', 'This job is no longer accepting applications. Thank you for your interest in our programs across research and development.'])), expected });
  ok('a stale indexed page that states it no longer accepts applications is closed even with an Apply link', closed.state === 'closed', closed.state);
  const expired = assessFetchedPage({ page: page(JNJ, jnjBody.replace('November 3, 2026', 'September 3, 2026')), expected });
  ok('an employer-stated deadline before retrieval is expired', expired.state === 'expired', expired.state);
  const removed = assessFetchedPage({ page: page(JNJ, 'Not Found', 404), expected });
  ok('HTTP 404 on an indexed requisition is removed', removed.state === 'removed');
  const workdayUrl = 'https://gilead.wd1.myworkdayjobs.com/en-US/gileadcareers/job/Intern---Research---Data-Sciences_R0054572';
  const workdayId = resolvePostingIdentity(workdayUrl);
  const shell = assessFetchedPage({ page: page(workdayUrl, '<html><head><script src="/wday/app.js"></script></head><body><div id="root"></div><noscript>Please enable JavaScript to view this page.</noscript></body></html>'), expected: workdayId });
  ok('a Workday script-only shell is script_only (unknown), not open', shell.state === 'script_only', shell.state);
  const vendorError = assessFetchedPage({ page: page(workdayUrl, html('Workday', ['The page you are looking for doesn\'t exist. Search for jobs or return to the careers home page to explore available roles and teams.'], false)), expected: workdayId });
  ok('a vendor HTML error page served with HTTP 200 is error_page', vendorError.state === 'error_page', vendorError.state);
  const bot = assessFetchedPage({ page: page(workdayUrl, html('Just a moment...', ['Checking your browser before accessing the site. This process is automatic and your browser will redirect shortly to the requested content once complete.'], false)), expected: workdayId });
  ok('a bot-check interstitial is blocked and never bypassed', bot.state === 'blocked', bot.state);
  ok('HTTP 403 and 429 are blocked', ['403', '429'].every((code) => assessFetchedPage({ page: page(workdayUrl, 'x', Number(code)), expected: workdayId }).state === 'blocked'));
}

console.log('=== Redirects and conflicting requisitions ===');
{
  const expected = resolvePostingIdentity(JNJ);
  const toSearch = assessFetchedPage({ page: page(JNJ, html('Search jobs', ['Explore thousands of roles across the company in every function and location worldwide.']), 200, {
    finalUrl: 'https://www.careers.jnj.com/en/jobs/', redirects: [{ url: JNJ, status: 302, location: 'https://www.careers.jnj.com/en/jobs/' }],
  }), expected });
  ok('a requisition redirected to the search page is redirected_away (stale index entry)', toSearch.state === 'redirected_away', toSearch.state);
  const locale = assessFetchedPage({ page: page(JNJ, jnjBody, 200, {
    finalUrl: 'https://www.careers.jnj.com/en-us/jobs/r-099898/oncology-discovery-scientist-intern',
    redirects: [{ url: JNJ, status: 301, location: 'https://www.careers.jnj.com/en-us/jobs/r-099898/oncology-discovery-scientist-intern' }],
  }), expected });
  ok('a locale redirect that keeps the requisition is still apply_visible', locale.state === 'apply_visible', locale.state);
  const otherReq = assessFetchedPage({ page: page(JNJ, jnjBody.replace('R-099898', 'R-099892'), 200, {
    finalUrl: 'https://www.careers.jnj.com/en/jobs/r-099892/oncology-clinical-scientist-intern',
  }), expected });
  ok('a redirect to a different requisition is requisition_conflict', otherReq.state === 'requisition_conflict', otherReq.state);
  const aldevronUrl = 'https://danaher.wd1.myworkdayjobs.com/en-US/DanaherJobs/job/Research---Development-Graduate-Intern_R1316744';
  const pageSaysSibling = assessFetchedPage({ page: page(aldevronUrl, html('Research & Development Graduate Intern', [
    'Job Requisition ID: R1316741', 'Aldevron is seeking a PhD candidate for our Waltham research and development team working on nucleic acid production.']), 200), expected: resolvePostingIdentity(aldevronUrl) });
  ok('URL R1316744 whose page states R1316741 is a conflict, never silently merged', pageSaysSibling.state === 'requisition_conflict', pageSaysSibling.state);
  const crossTenant = assessFetchedPage({ page: page(JNJ, jnjBody, 200, { finalUrl: 'https://jobs.example-aggregator.com/view/123' }), expected });
  ok('a redirect off the employer tenant is redirected_away', crossTenant.state === 'redirected_away', crossTenant.state);
}

console.log('=== Gates: evidence or explicit unknown ===');
{
  const text = pageText(jnjBody);
  const gates = extractGates(text, 'apply_visible', AT);
  const quotes = Object.values(gates).map((gate) => gate.quote).filter((quote): quote is string => !!quote);
  ok('every gate quote is a literal substring of the stored text', quotes.length > 3 && quotes.every((quote) => text.includes(quote)), quotes);
  ok('graduate access is read from employer text', gates.degreeLevel.value === 'graduate_accepted', gates.degreeLevel);
  ok('permanent authorization without sponsorship is recognized', gates.workAuthorization.value === 'permanent_no_sponsorship', gates.workAuthorization);
  ok('continued enrollment is recognized', gates.continuedEnrollment.value === 'required', gates.continuedEnrollment);
  ok('the anticipated close is a dated deadline with its sentence', gates.deadline.date === '2026-11-03' && !!gates.deadline.quote);
  ok('summer 2027 term is extracted', gates.term.season === 'summer' && gates.term.year === 2027, gates.term);
  const roche = extractGates(pageText(html('2027 Summer Intern - QR&E', [
    'Candidates must be currently enrolled in an undergraduate degree program with at least two years remaining after the internship.'])), 'apply_visible', AT);
  ok('Roche QR&E undergraduate restriction is undergraduate_only', roche.degreeLevel.value === 'undergraduate_only', roche.degreeLevel);
  ok('year-in-program remaining is captured', /two years remaining/i.test(roche.yearInProgram.value), roche.yearInProgram);
  const northeastern = extractGates(pageText(html('Co-Op, Platform Biology', [
    'This program is open only to current students at Northeastern University through the co-op office.'])), 'apply_visible', AT);
  ok('Northeastern-only co-op is named_institution_only', northeastern.institutionRestriction.value === 'named_institution_only', northeastern.institutionRestriction);
  const ibri = extractGates(pageText(html('Biology Research Intern 2027', [
    'Open to undergraduate or graduate students enrolled at an Indiana college or university, or graduates of an Indiana high school.'])), 'apply_visible', AT);
  ok('IBRI Indiana affiliation is regional_affiliation and graduate-accessible, not an institution-only exclusion',
    ibri.institutionRestriction.value === 'regional_affiliation' && ibri.degreeLevel.value === 'graduate_accepted', ibri);
  const mda = extractGates(pageText(html('Research Intern - Radiation Oncology', [
    'Applicants must have received a bachelor\'s or master\'s degree within the past one year and must not be currently enrolled in a degree program.',
    'Applicants associated with a home institution are not eligible.'])), 'apply_visible', AT);
  ok('MD Anderson recent-graduate appointment is recent_graduate_only with enrollment excluded',
    mda.degreeLevel.value === 'recent_graduate_only' && mda.continuedEnrollment.value === 'must_not_be_enrolled', mda);
  const silent = extractGates(pageText(html('Laboratory Intern', ['Support the lab team with sample preparation and documentation.'])), 'apply_visible', AT);
  ok('silent pages yield not_stated, never an inferred value', silent.degreeLevel.value === 'not_stated'
    && silent.workAuthorization.value === 'not_stated' && silent.institutionRestriction.value === 'not_stated' && silent.degreeLevel.quote === null);
  ok('generic titles do not count as an exact match', compareTitles('Intern', 'Intern') === 'unknown');
  ok('different roles at the same employer are title mismatches', compareTitles('Oncology Discovery Scientist Intern', 'Global Regulatory Affairs Intern') === 'different');
}

console.log('=== Duplicates across every table ===');
{
  ok('nearby requisition numbers stay distinct', !sameRequisition('R0026869', 'R00268691'));
  ok('format-only requisition variants match', sameRequisition('R-0026869', 'R0026869'));
  const elancoClinton = resolvePostingIdentity('https://elanco.wd5.myworkdayjobs.com/External_Career/job/Clinton-IN/Manufacturing-Scientist-Technical-Services-Intern_R0026869-1');
  const existing: ExistingRecord[] = [
    { table: 'opportunities', id: 'opp-indy', url: 'https://elanco.wd5.myworkdayjobs.com/en-US/External_Career/job/Indianapolis-IN/Manufacturing-Scientist-Technical-Services-Intern_R0026897', title: 'Manufacturing Scientist/Technical Services Intern', employer: 'Elanco' },
  ];
  const decision = decideDuplicate(elancoClinton, 'Manufacturing Scientist/Technical Services Intern', existing);
  ok('different-location requisitions with the same title stay distinct', decision.decision === 'distinct', decision);
  ok('the sibling requisition is surfaced as related, not merged', decision.related.length === 1 && decision.related[0].basis === 'related_title_different_requisition');
  const localeDup = decideDuplicate(resolvePostingIdentity(JNJ), 'Oncology Discovery Scientist Intern', [
    { table: 'opportunities', id: 'opp-jnj', url: 'https://www.careers.jnj.com/en-us/jobs/r-099898/oncology-discovery-scientist-intern/', title: 'Oncology Discovery Scientist Intern', employer: 'Johnson & Johnson', status: 'open_verified' },
  ]);
  ok('the same requisition under another locale and trailing slash is an existing opportunity', localeDup.decision === 'existing_opportunity', localeDup);
  const byExternalId = decideDuplicate(resolvePostingIdentity('https://job-boards.greenhouse.io/nanopathinc/jobs/4605514005'), null, [
    { table: 'source_postings', id: 'sp-1', url: 'https://boards.greenhouse.io/nanopathinc/jobs/4605514005?gh_src=abc', title: 'Research Associate Co-op', employer: 'Nanopath', requisitionId: '4605514005' },
  ]);
  ok('a governed feed posting with the same board and job ID is an existing source posting', byExternalId.decision === 'existing_source_posting', byExternalId);
  const repeat = decideDuplicate(resolvePostingIdentity(JNJ), null, [
    { table: 'posting_verifications', id: 'pv-1', url: JNJ, title: null, employer: null, status: 'review_candidate' },
  ]);
  ok('an earlier review candidate for the same requisition is a repeat, not a second task', repeat.decision === 'repeat_candidate');
  const leadOnly = decideDuplicate(resolvePostingIdentity(JNJ), null, [
    { table: 'discovery_leads', id: 'lead-1', url: JNJ, title: null, employer: null },
    { table: 'user_submissions', id: 'sub-1', url: JNJ, title: null, employer: null },
  ]);
  ok('matching leads and research records are linked but do not make the role a duplicate of a reviewed record',
    leadOnly.decision === 'distinct' && leadOnly.matches.length === 2);
}

console.log('=== Outcomes ===');
{
  const lead = { employer: 'Johnson & Johnson', title: 'Oncology Discovery Scientist Intern', url: JNJ, location: 'Spring House, PA', cycle: 'Summer 2027' };
  const assessment = assessFetchedPage({ page: page(JNJ, jnjBody), expected: resolvePostingIdentity(JNJ) });
  const candidate = decideVerification({ lead, assessment, existing: [], retrievedAt: AT });
  ok('a distinct, attributed, apply-visible requisition is a review candidate', candidate.outcome === 'review_candidate', candidate.reasons);
  ok('identity comparison records requisition, location and cycle agreement',
    candidate.comparison.requisition === 'match' && candidate.comparison.location === 'match' && candidate.comparison.cycle === 'match', candidate.comparison);
  const indexOnly = decideVerification({ lead, assessment: null, governanceReason: 'no reviewed source', existing: [], retrievedAt: AT });
  ok('an index result without a governed fetch stays unresolved', indexOnly.outcome === 'unresolved_governance');
  ok('a LinkedIn URL is never a requisition', decideVerification({ lead: { ...lead, url: 'https://www.linkedin.com/jobs/view/4459590304' }, assessment: null, existing: [], retrievedAt: AT }).outcome === 'rejected_not_requisition');
  const flagship = 'https://job-boards.greenhouse.io/fspco-op012325/jobs/4600000001';
  const flagshipBody = html('Co-Op, Platform Biology', ['Flagship Pioneering co-op in Cambridge for spring 2027 with lab and computational work.']);
  const flagshipDecision = decideVerification({ lead: { employer: 'Flagship Pioneering', title: 'Co-Op, Platform Biology', url: flagship },
    assessment: assessFetchedPage({ page: page(flagship, flagshipBody), expected: resolvePostingIdentity(flagship) }), existing: [], retrievedAt: AT });
  ok('a Northeastern-only co-op board is gate_excluded even when the page is silent', flagshipDecision.outcome === 'gate_excluded', flagshipDecision.reasons);
  const titleSwap = decideVerification({ lead: { ...lead, title: 'Global Regulatory Affairs Intern' }, assessment, existing: [], retrievedAt: AT });
  ok('a page for a different role is rejected_title_mismatch and archived', titleSwap.outcome === 'rejected_title_mismatch');
  ok('deadline within two weeks raises review priority', decideVerification({ lead,
    assessment: assessFetchedPage({ page: page(JNJ, jnjBody.replace('November 3, 2026', 'October 3, 2026')), expected: resolvePostingIdentity(JNJ) }),
    existing: [], retrievedAt: AT }).reviewPriority <= 5);
  ok('contact data is redacted', !/talent\.person|555-123-4567/.test(redactContacts(pageText(jnjBody))));
}

console.log('=== Governance ===');
{
  const base: VerificationSourceRow = {
    id: 'src-jnj', source_name: 'J&J careers', source_kind: 'static_html', source_identifier: null,
    careers_url: 'https://www.careers.jnj.com/en/jobs/', api_endpoint: null,
    config_json: { requisition_verification: { enabled: true, hosts: ['www.careers.jnj.com'], tenant_key: 'www.careers.jnj.com', path_prefixes: ['/en/jobs/', '/es-la/jobs/'] } },
    enabled: true, terms_reviewed: true, terms_review_date: '2026-09-20', robots_reviewed: true, automatic_scheduling_paused_at: null,
    consecutive_failures: 0, fetch_tier: 0, tier_clean_runs: 0, last_successful_at: null,
  };
  const identity = resolvePostingIdentity(JNJ);
  ok('an enabled, reviewed source with an explicit requisition scope authorizes a page fetch', governVerification(identity, [base]).mode === 'page');
  ok('no source means no fetch', governVerification(identity, []).mode === 'blocked');
  ok('a disabled source blocks', governVerification(identity, [{ ...base, enabled: false }]).mode === 'blocked');
  ok('an incomplete robots review blocks', governVerification(identity, [{ ...base, robots_reviewed: false }]).mode === 'blocked');
  ok('paused scheduling blocks', governVerification(identity, [{ ...base, automatic_scheduling_paused_at: '2026-09-01T00:00:00Z' }]).mode === 'blocked');
  ok('a reviewed feed without an explicit verification scope does not authorize page fetches',
    governVerification(identity, [{ ...base, config_json: {} }]).mode === 'blocked');
  ok('a path outside the reviewed prefixes is not covered',
    governVerification(resolvePostingIdentity('https://www.careers.jnj.com/fr-fr/jobs/r-099898/x'), [base]).mode === 'blocked');
  ok('a reviewed HTTPS scope does not authorize HTTP requisition fetches',
    governVerification(resolvePostingIdentity('http://www.careers.jnj.com/en/jobs/r-099898/x'), [base]).mode === 'blocked');
  ok('a host-only legacy scope is not sufficient to authorize a fetch', governVerification(identity, [{ ...base,
    config_json: { requisition_verification: { enabled: true, hosts: ['www.careers.jnj.com'], path_prefixes: ['/en/jobs/'] } },
  }]).mode === 'blocked');
  const scope = buildVerificationScope({ careersUrl: 'https://www.careers.jnj.com/en/jobs/', enabled: true, verificationOnly: true,
    pathPrefixes: '/en/jobs/, /es-la/jobs/', reviewedBy: 'officer-1', reviewedOn: '2026-09-26' });
  ok('an officer scope is limited to the source careers host and records who reviewed it',
    JSON.stringify(scope.hosts) === '["www.careers.jnj.com"]' && scope.tenant_key === 'www.careers.jnj.com'
      && (scope.path_prefixes as string[]).length === 2 && scope.reviewed_by === 'officer-1');
  let broadScope = false;
  try { buildVerificationScope({ careersUrl: 'https://job-boards.greenhouse.io/ginkgobioworks', enabled: true,
    verificationOnly: true, pathPrefixes: '', reviewedBy: 'x', reviewedOn: 'y' }); } catch { broadScope = true; }
  ok('an enabled shared-host scope needs a specific path', broadScope);
  const boardScope = buildVerificationScope({ careersUrl: 'https://job-boards.greenhouse.io/ginkgobioworks', enabled: true,
    verificationOnly: true, pathPrefixes: '/ginkgobioworks/jobs/', reviewedBy: 'x', reviewedOn: 'y' });
  ok('board scope cannot authorize another employer on the same host', governVerification(
    resolvePostingIdentity('https://job-boards.greenhouse.io/nanopathinc/jobs/4605514005'), [{ ...base,
      source_kind: 'static_html', careers_url: 'https://job-boards.greenhouse.io/ginkgobioworks',
      config_json: { requisition_verification: boardScope },
    }]).mode === 'blocked');
  let badPrefix = false;
  try { buildVerificationScope({ careersUrl: 'https://www.careers.jnj.com/', enabled: true, verificationOnly: false, pathPrefixes: '../admin', reviewedBy: 'x', reviewedOn: 'y' }); }
  catch { badPrefix = true; }
  ok('invalid verification path prefixes are refused', badPrefix);
  const ginkgo: VerificationSourceRow = { ...base, id: 'src-ginkgo', source_kind: 'greenhouse', source_identifier: 'ginkgobioworks', config_json: {} };
  ok('a reviewed Greenhouse feed answers for its own board', governVerification(resolvePostingIdentity('https://job-boards.greenhouse.io/ginkgobioworks/jobs/5033171007'), [ginkgo]).mode === 'feed');
  ok('a reviewed Greenhouse feed does not authorize another board on the same host',
    governVerification(resolvePostingIdentity('https://job-boards.greenhouse.io/nanopathinc/jobs/4605514005'), [ginkgo]).mode === 'blocked');
}

console.log('=== Runner boundary ===');
{
  const calls: { rpc: Array<Record<string, unknown>>; uploads: string[]; fetches: string[] } = { rpc: [], uploads: [], fetches: [] };
  const sources = [{
    id: 'src-jnj', source_name: 'J&J careers', source_kind: 'static_html', source_identifier: null, careers_url: 'https://www.careers.jnj.com/en/jobs/',
    api_endpoint: null, config_json: { requisition_verification: { enabled: true, hosts: ['www.careers.jnj.com'], tenant_key: 'www.careers.jnj.com', path_prefixes: ['/en/jobs/'] } },
    enabled: true, terms_reviewed: true, terms_review_date: '2026-09-20', robots_reviewed: true, automatic_scheduling_paused_at: null,
    consecutive_failures: 0, fetch_tier: 0, tier_clean_runs: 0, last_successful_at: null,
  }];
  const submissions = [
    { id: 'sub-jnj', created_at: '2026-09-24T00:00:00Z', payload: { intake_stage: 'source_research', company: 'Johnson & Johnson', title: 'Oncology Discovery Scientist Intern', candidate_employer_url: JNJ } },
    { id: 'sub-gilead', created_at: '2026-09-24T00:00:00Z', payload: { intake_stage: 'source_research', company: 'Gilead Sciences', title: 'Intern - Research - Data Sciences', candidate_employer_url: 'https://gilead.wd1.myworkdayjobs.com/en-US/gileadcareers/job/Intern---Research---Data-Sciences_R0054572' } },
    { id: 'sub-li', created_at: '2026-09-24T00:00:00Z', payload: { intake_stage: 'source_research', company: 'Aldevron', title: 'R&D Graduate Intern', candidate_employer_url: 'https://www.linkedin.com/jobs/view/4459590304' } },
  ];
  function chain(result: unknown) {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'ilike', 'or']) query[method] = () => query;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  }
  const db = {
    from(table: string) {
      if (table === 'job_sources') return chain({ data: sources, error: null });
      if (table === 'user_submissions') return chain({ data: submissions, error: null });
      return chain({ data: [], error: null });
    },
    async rpc(name: string, args: { p_row: Record<string, unknown> }) {
      calls.rpc.push({ name, ...args.p_row });
      return { data: [{ verification_id: 'v', review_task_id: args.p_row.outcome === 'review_candidate' ? 'task-1' : null, created: true }], error: null };
    },
  };
  const storage = { from: () => ({ upload: async (path: string) => { calls.uploads.push(path); return { error: null }; } }) };
  const fetcher = async (url: string) => { calls.fetches.push(url); return { finalUrl: url, status: 200, etag: null, lastModified: null, body: jnjBody, contentType: 'text/html', redirects: [] }; };
  const report = await runPostingVerificationBatch({ db: db as never, storage, fetcher, now: new Date(AT), limit: 5, hostSpacingMs: 0, runId: 'test-run' });
  ok('only the governed tenant is fetched; Workday and LinkedIn are not', calls.fetches.length === 1 && calls.fetches[0].includes('careers.jnj.com'), calls.fetches);
  ok('one review task is requested for the verified candidate', report.reviewTasks === 1 && report.outcomes.review_candidate === 1, report);
  ok('an ungoverned tenant is recorded as a coverage gap, not silently dropped',
    report.outcomes.unresolved_governance === 1 && Object.keys(report.governanceGaps).some((key) => key.includes('gilead.wd1')), report.governanceGaps);
  ok('the LinkedIn research link is archived as not a requisition', report.outcomes.rejected_not_requisition === 1);
  const recorded = calls.rpc.find((row) => row.outcome === 'review_candidate') as Record<string, unknown> | undefined;
  ok('the recorded candidate carries hash, snapshot path, HTTP state, retrieval time and requisition',
    !!recorded && /^[0-9a-f]{64}$/.test(String(recorded.content_sha256)) && String(recorded.snapshot_storage_path).startsWith('verification/src-jnj/')
    && recorded.http_status === 200 && recorded.retrieved_at === calls.rpc[0].retrieved_at && recorded.requisition_id === 'R-099898', recorded);
  ok('the raw snapshot is stored in the private payload bucket', calls.uploads.length === 1 && calls.uploads[0] === recorded?.snapshot_storage_path);
  ok('task notes carry evidence and no private contact data', typeof recorded?.task_notes === 'string'
    && /Deadline: 2026-11-03/.test(String(recorded.task_notes)) && !/talent\.person|555-123-4567/.test(String(recorded.task_notes)), recorded?.task_notes);
  ok('every archived row has an explicit outcome and page state', calls.rpc.every((row) => typeof row.outcome === 'string' && typeof row.page_state === 'string'));

  calls.rpc.length = 0; calls.uploads.length = 0; calls.fetches.length = 0;
  const offHost = async (url: string) => ({ finalUrl: 'https://tracker.example.net/landing', status: 200, etag: null, lastModified: null, body: jnjBody, contentType: 'text/html',
    redirects: [{ url, status: 302, location: 'https://tracker.example.net/landing' }] });
  const leaving = await runPostingVerificationBatch({ db: db as never, storage, fetcher: offHost, now: new Date(AT), limit: 5, hostSpacingMs: 0, runId: 'off-host' });
  const leavingRow = calls.rpc.find((row) => row.run_id === 'off-host' && row.page_state === 'redirected_away') as Record<string, unknown> | undefined;
  ok('a redirect off the reviewed host stores nothing from the foreign page and is not a candidate',
    !!leavingRow && leavingRow.content_sha256 === null && calls.uploads.length === 0 && !leaving.outcomes.review_candidate
    && Array.isArray(leavingRow.redirect_chain) && (leavingRow.redirect_chain as unknown[]).length === 1, leavingRow);

  calls.rpc.length = 0; calls.uploads.length = 0; calls.fetches.length = 0;
  const dry = await runPostingVerificationBatch({ db: db as never, storage, fetcher, now: new Date(AT), limit: 5, hostSpacingMs: 0, dryRun: true });
  ok('a dry run fetches governed pages but writes nothing', dry.dryRun && calls.rpc.length === 0 && calls.uploads.length === 0 && dry.decisions.length === 3);

  calls.rpc.length = 0; calls.uploads.length = 0;
  const shellFetch = async (url: string) => ({ finalUrl: url, status: 200, etag: null, lastModified: null,
    body: '<html><script src="/app.js"></script><div id="root"></div><noscript>Please enable JavaScript to view this page.</noscript></html>',
    contentType: 'text/html', redirects: [] });
  const rendered = await runPostingVerificationBatch({ db: db as never, storage, fetcher: shellFetch,
    scrapling: async () => jnjBody, now: new Date(AT), limit: 5, hostSpacingMs: 0, runId: 'rendered' });
  ok('renderer text without a final URL is archived but cannot create an Apply-visible review task',
    !rendered.outcomes.review_candidate && rendered.reviewTasks === 0
      && calls.rpc.some((row) => row.page_state === 'ambiguous' && row.outcome === 'unresolved_page'), rendered);

  const blocked = async (url: string) => { calls.fetches.push(url); return { finalUrl: url, status: 429, etag: null, lastModified: null, body: 'Too many requests', contentType: 'text/plain', redirects: [] }; };
  calls.fetches.length = 0;
  submissions.push({ id: 'sub-jnj-2', created_at: '2026-09-24T00:00:00Z', payload: { intake_stage: 'source_research', company: 'Johnson & Johnson',
    title: 'Oncology Clinical Scientist Intern', candidate_employer_url: 'https://www.careers.jnj.com/en/jobs/r-099892/oncology-clinical-scientist-intern/' } });
  const limited = await runPostingVerificationBatch({ db: db as never, storage, fetcher: blocked, now: new Date(AT), limit: 5, hostSpacingMs: 0, dryRun: true });
  ok('a 429 is recorded as blocked and the host is not requested again in the run', calls.fetches.length === 1
    && limited.decisions.some((item) => item.pageState === 'blocked')
    && limited.decisions.some((item) => item.url.includes('r-099892') && item.outcome === 'unresolved_governance'), limited.decisions);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
