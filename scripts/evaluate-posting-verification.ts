import { runEvaluation, type ArmSummary } from '../src/lib/pipeline/eval/verification-eval';

// Offline before/after replay on the fixed evaluation set. Not live coverage.
const result = runEvaluation();
const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${n}/${d} (${Math.round((n / d) * 100)}%)`);
function arm(summary: ArmSummary) {
  return {
    arm: summary.arm,
    distinctRoles: summary.identifiable,
    queryReachable: pct(summary.discovered, summary.identifiable),
    reachableWithoutEmployerNames: pct(summary.discoveredEmployerAgnostic, summary.identifiable),
    candidateUrlAccepted: pct(summary.candidateAccepted, summary.withOfficialUrl),
    requisitionIdCorrect: pct(summary.requisitionCorrect, summary.requisitionScored),
    employerAttributionPrecision: pct(summary.attributionCorrect, summary.attributionClaimed),
    reachedOfficerReview: summary.reachedReview,
    evidenceBackedDecisions: pct(summary.resolvedDecisions, summary.withOfficialUrl),
    falseOpenClaims: summary.falseOpen,
    medianRotationDaysToFirstSearch: summary.medianCycleDays,
    failuresByCause: summary.causes,
  };
}
const output = {
  queries: result.queryCounts,
  before: arm(result.before),
  afterMechanism: arm(result.afterAllTenants),
  afterProductionSources: arm(result.afterProduction),
  gates: result.gates.map((gate) => ({ gate: gate.gate, precision: pct(gate.correct, gate.asserted), recall: pct(gate.recovered, gate.expectedSpecified), errors: gate.errors.filter((error) => error.expected !== 'unknown') })),
  duplicates: result.duplicates,
  attributionTraps: result.attributionTraps,
  urlLevel: Object.fromEntries(Object.entries(result.urlLevel).map(([key, value]) => [key, {
    urls: value.urls,
    requisitionIdCorrect: pct(value.requisitionCorrect, value.requisitionScored),
    requisitionErrors: value.requisitionErrors,
    employerAttributionPrecision: pct(value.attributionCorrect, value.attributionClaims),
    attributionErrors: value.attributionErrors,
  }])),
  rows: process.env.EVAL_ROWS === 'true' ? {
    before: result.before.rows, after: result.afterAllTenants.rows, production: result.afterProduction.rows,
  } : undefined,
};
console.log(JSON.stringify(output, null, 2));
