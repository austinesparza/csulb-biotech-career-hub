import { describe, expect, it } from 'vitest';
import historicalData from '../../data/historical-opportunities.json';

describe('historical employer directory data', () => {
  it('preserves every role from both supplied tracking cycles', () => {
    expect(historicalData.roles).toHaveLength(51);
    expect(new Set(historicalData.roles.map((role) => role.cycle))).toEqual(
      new Set(['2024-2025', '2025-2026']),
    );
  });

  it('keeps historical sources and uncertain employer identity explicit', () => {
    expect(historicalData.roles.every((role) => role.url && role.source)).toBe(true);
    expect(historicalData.roles.some((role) => role.company === 'Employer not recorded')).toBe(true);
  });
});
