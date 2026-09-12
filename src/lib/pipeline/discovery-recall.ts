export interface DiscoveryRecallExpectation {
  id: string;
  employer: string;
  title: string;
  sourceUrl: string | null;
  audience: 'undergraduate' | 'graduate' | 'mixed' | 'unknown';
  reviewIntent: 'core' | 'adjacent';
}

export interface DiscoveryRecallObservation {
  originalUrl: string;
  title: string | null;
  employer: string | null;
}

export interface DiscoveryRecallMatch {
  expectation: DiscoveryRecallExpectation;
  observation: DiscoveryRecallObservation | null;
  matchBasis: 'url' | 'employer_title' | null;
}

export interface DiscoveryRecallReport {
  expected: number;
  recovered: number;
  recall: number;
  matches: DiscoveryRecallMatch[];
}

const EMPLOYER_SUFFIXES = new Set([
  'biotech', 'corporation', 'diagnostics', 'inc', 'incorporated', 'llc', 'pharma', 'sciences',
]);
const TITLE_NOISE = new Set([
  'a', 'an', 'and', 'at', 'co', 'coop', 'for', 'future', 'in', 'intern', 'internship', 'interns',
  'of', 'on', 'op', 'opportunities', 'program', 'talent', 'the', 'to',
]);

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = '';
    url.searchParams.delete('currentJobId');
    url.searchParams.delete('trackingId');
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

function tokens(value: string, excluded: Set<string>): Set<string> {
  return new Set(normalize(value).split(' ').filter((token) => token && !excluded.has(token)));
}

function containment(expected: Set<string>, observed: Set<string>): number {
  if (expected.size === 0) return 0;
  let intersection = 0;
  for (const token of expected) if (observed.has(token)) intersection += 1;
  return intersection / expected.size;
}

function employerMatches(expected: string, observed: string | null): boolean {
  if (!observed) return false;
  const expectedTokens = tokens(expected, EMPLOYER_SUFFIXES);
  const observedTokens = tokens(observed, EMPLOYER_SUFFIXES);
  return containment(expectedTokens, observedTokens) >= 0.75
    || containment(observedTokens, expectedTokens) >= 0.75;
}

function titleMatches(expected: string, observed: string | null): boolean {
  if (!observed) return false;
  const expectedTokens = tokens(expected, TITLE_NOISE);
  const observedTokens = tokens(observed, TITLE_NOISE);
  return containment(expectedTokens, observedTokens) >= 0.65;
}

/**
 * Scores archived leads against an officer-observed set. This is an evaluation
 * boundary only: it does not publish, relabel, or train on any record.
 */
export function measureDiscoveryRecall(
  expectations: DiscoveryRecallExpectation[],
  observations: DiscoveryRecallObservation[],
): DiscoveryRecallReport {
  const matches = expectations.map((expectation): DiscoveryRecallMatch => {
    const expectedUrl = normalizedUrl(expectation.sourceUrl);
    if (expectedUrl) {
      const urlMatch = observations.find((observation) => normalizedUrl(observation.originalUrl) === expectedUrl);
      if (urlMatch) return { expectation, observation: urlMatch, matchBasis: 'url' };
    }
    const contentMatch = observations.find((observation) => (
      employerMatches(expectation.employer, observation.employer)
      && titleMatches(expectation.title, observation.title)
    ));
    return contentMatch
      ? { expectation, observation: contentMatch, matchBasis: 'employer_title' }
      : { expectation, observation: null, matchBasis: null };
  });
  const recovered = matches.filter((match) => match.observation !== null).length;
  return {
    expected: expectations.length,
    recovered,
    recall: expectations.length === 0 ? 1 : recovered / expectations.length,
    matches,
  };
}
