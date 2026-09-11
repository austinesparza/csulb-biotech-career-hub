import { describe, expect, it } from 'vitest';

import {
  GOVERNED_STARTER_SOURCES,
  GREENHOUSE_POLICY_LINKS,
  governedStarterSource,
} from '../../lib/ingestion/starter-sources';
import { validateBoardToken } from '../../lib/ingestion/connectors/greenhouse';

describe('governed starter sources', () => {
  it('uses a small unique cohort of valid public Greenhouse boards', () => {
    expect(GOVERNED_STARTER_SOURCES).toHaveLength(3);
    expect(new Set(GOVERNED_STARTER_SOURCES.map((source) => source.id)).size).toBe(3);
    expect(new Set(GOVERNED_STARTER_SOURCES.map((source) => source.boardToken)).size).toBe(3);

    for (const source of GOVERNED_STARTER_SOURCES) {
      expect(validateBoardToken(source.boardToken).valid).toBe(true);
      expect(new URL(source.careersUrl).protocol).toBe('https:');
      expect(new URL(source.careersUrl).hostname).toBe('job-boards.greenhouse.io');
      expect(source.fetchIntervalHours).toBeGreaterThanOrEqual(24);
      expect(source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.rationale.length).toBeGreaterThan(20);
    }
  });

  it('looks up only declared sources', () => {
    expect(governedStarterSource('xaira-therapeutics')?.boardToken).toBe('xairatherapeutics');
    expect(governedStarterSource('not-declared')).toBeNull();
  });

  it('links officers to official API and robots evidence', () => {
    expect(GREENHOUSE_POLICY_LINKS.apiDocumentation).toMatch(/^https:\/\/docs\.greenhouse\.io\//);
    expect(GREENHOUSE_POLICY_LINKS.apiRobots).toBe('https://boards-api.greenhouse.io/robots.txt');
    expect(GREENHOUSE_POLICY_LINKS.boardRobots).toBe('https://job-boards.greenhouse.io/robots.txt');
  });
});
