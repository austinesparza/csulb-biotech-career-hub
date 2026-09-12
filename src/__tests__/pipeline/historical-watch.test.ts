import { buildHistoricalWatchPlans, getHistoricalWatchMetadata, historicalWatchPriority } from '../../lib/pipeline/historical-watch';

let pass = 0;
let fail = 0;
const ok = (name: string, condition: boolean, detail = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  -> ${detail}`}`);
};

const plans = buildHistoricalWatchPlans({ cycleYear: 2027, month: 9 });
const metadata = getHistoricalWatchMetadata();
ok('history materially expands the watched employer set', plans.length >= 25, String(plans.length));
ok('program-family language reaches the search plan', plans.some((item) => (
  item.company === 'Johnson & Johnson'
  && item.plan.queries.some((query) => query.query.includes('Quality Compliance Internship'))
)));
const sanofi = plans.find((item) => item.company === 'Sanofi')!;
ok('an observed month raises search priority', historicalWatchPriority(sanofi, 9) > historicalWatchPriority(sanofi, 4));
ok('sparse history is not mislabeled as prediction-ready', plans.every((item) => !item.predictionReady));
ok('the prediction threshold is explicit', metadata.minimumCyclesForPrediction === 3);
ok('every plan remains bounded to five queries', plans.every((item) => item.plan.queries.length === 5));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
