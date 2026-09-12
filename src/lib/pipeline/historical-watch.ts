import snapshot from '../../../data/historical-opportunity-watch.json';
import { buildEmployerSearchPlan, type EmployerSearchPlan } from './search-plan';

export interface HistoricalWatchSignal {
  company: string;
  careersDomain: string | null;
  observedMonths: number[];
  cycles: string[];
  programTerms: string[];
}

export interface HistoricalWatchPlan extends HistoricalWatchSignal {
  priority: number;
  predictionReady: boolean;
  plan: EmployerSearchPlan;
}

const signals = snapshot.employers as HistoricalWatchSignal[];

function circularMonthDistance(a: number, b: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, 12 - direct);
}

export function historicalWatchPriority(signal: HistoricalWatchSignal, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('month must be from 1 to 12');
  const nearest = signal.observedMonths.length
    ? Math.min(...signal.observedMonths.map((observed) => circularMonthDistance(observed, month)))
    : 6;
  const timing = nearest <= 1 ? 30 : nearest === 2 ? 15 : 0;
  return timing + Math.min(signal.cycles.length, 3) * 8 + Math.min(signal.programTerms.length, 4) * 2;
}

/**
 * Builds discovery plans from club history. These are search priorities only.
 * At least three observed cycles are required before the data is described as
 * prediction-ready; current records are explicitly lower-confidence signals.
 */
export function buildHistoricalWatchPlans(input: {
  cycleYear: number;
  month: number;
}): HistoricalWatchPlan[] {
  return signals
    .map((signal) => ({
      ...signal,
      priority: historicalWatchPriority(signal, input.month),
      predictionReady: signal.cycles.length >= snapshot._meta.minimumCyclesForPrediction,
      plan: buildEmployerSearchPlan({
        employer: signal.company,
        cycleYear: input.cycleYear,
        careersDomain: signal.careersDomain,
        programTerms: signal.programTerms,
      }),
    }))
    .toSorted((a, b) => b.priority - a.priority || a.company.localeCompare(b.company));
}

export function getHistoricalWatchMetadata() {
  return snapshot._meta;
}
