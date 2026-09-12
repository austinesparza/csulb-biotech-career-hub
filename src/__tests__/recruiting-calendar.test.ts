import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_ARCHIVE_SUMMARY,
  HISTORICAL_ROLE_ACTIVITY,
  WATCHED_EMPLOYERS,
  monthName,
} from '../lib/recruitingCalendar';

describe('recruiting calendar evidence', () => {
  it('accounts for every dated role in the supplied archive', () => {
    expect(HISTORICAL_ROLE_ACTIVITY.reduce<number>((sum, count) => sum + count, 0))
      .toBe(HISTORICAL_ARCHIVE_SUMMARY.datedRoles);
    expect(HISTORICAL_ARCHIVE_SUMMARY.roles - HISTORICAL_ARCHIVE_SUMMARY.datedRoles).toBe(3);
  });

  it('keeps the expanded watchlist unique and evidence-labelled', () => {
    expect(WATCHED_EMPLOYERS).toHaveLength(39);
    expect(new Set(WATCHED_EMPLOYERS.map((item) => item.employer)).size).toBe(WATCHED_EMPLOYERS.length);
    expect(WATCHED_EMPLOYERS.filter((item) => item.evidence === 'club archive')).toHaveLength(30);
    expect(WATCHED_EMPLOYERS.filter((item) => item.evidence === 'broader search')).toHaveLength(9);
  });

  it('preserves historical program terms without implying a current opening', () => {
    const zymo = WATCHED_EMPLOYERS.find((item) => item.employer === 'Zymo Research');
    expect(zymo?.evidence).toBe('club archive');
    expect(zymo?.programTerms).toContain('Microbiome Research Intern');
    expect(zymo?.observedMonths.map(monthName)).toEqual(['Sep', 'Oct']);
  });
});
