/**
 * Regression gates on the fixed evaluation set. These pin mechanism
 * properties; they are not claims of live coverage.
 */
import { runEvaluation } from '../../lib/pipeline/eval/verification-eval';

let passed = 0;
let failed = 0;
function ok(name: string, assertion: boolean, detail: unknown = ''): void {
  console.log(`${assertion ? 'PASS' : 'FAIL'} ${name}${assertion ? '' : `  -> ${JSON.stringify(detail)}`}`);
  assertion ? passed++ : failed++;
}

const result = runEvaluation();
const { before, afterAllTenants: after, afterProduction: production } = result;
ok('no arm ever labels a closed, script-only or indexed-only role as apply-visible', before.falseOpen + after.falseOpen + production.falseOpen === 0);
ok('distinct requisitions are never merged', result.duplicates.wrongMerges.length === 0, result.duplicates.wrongMerges);
ok('same-requisition variants are merged', result.duplicates.missedMerges.length === 0, result.duplicates.missedMerges);
ok('known approved records are detected as existing before any fetch', result.duplicates.existingDetected === result.duplicates.existingExpected);
ok('no misleading tenant is attributed from the URL alone', result.attributionTraps.afterWrongClaims.length === 0, result.attributionTraps);
ok('the earlier URL rule attributed misleading tenants (regression baseline)', result.attributionTraps.beforeWrongClaims.length > 0);
ok('requisition parsing does not regress', result.urlLevel.after.requisitionCorrect >= result.urlLevel.before.requisitionCorrect);
ok('employer-agnostic reachability does not regress', after.discoveredEmployerAgnostic >= before.discoveredEmployerAgnostic);
ok('every identifiable role that does not reach review has a recorded cause', after.rows.every((row) => row.cause.length > 0));
ok('with the documented production sources nothing is auto-verified (activation blocker stays visible)', production.reachedReview === 0);
ok('only readable employer pages become review candidates', after.rows.filter((row) => row.cause === 'reached_review').every((row) => row.pageState === 'apply_visible'));
ok('gate assertions on readable pages are precise', result.gates.every((gate) => gate.asserted === 0 || gate.correct / gate.asserted >= 0.85), result.gates);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
