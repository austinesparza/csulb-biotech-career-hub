const EXACT_ATS_HOSTS = new Set([
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.ashbyhq.com',
  'jobs.jobvite.com',
  'jobs.lever.co',
  'recruiting.ultipro.com',
]);

const ATS_HOST_SUFFIXES = [
  '.bamboohr.com',
  '.myworkdayjobs.com',
];

/**
 * Public ATS posting hosts that discovery may treat as employer-controlled
 * candidates. Recognition does not authorize direct crawling or publication.
 */
export function isRecognizedAtsHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  return EXACT_ATS_HOSTS.has(normalized)
    || ATS_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Kept deliberately short so lane searches stay within provider query limits. */
export function atsSearchClause(): string {
  return [
    'site:boards.greenhouse.io',
    'site:jobs.lever.co',
    'site:jobs.ashbyhq.com',
    'site:myworkdayjobs.com',
    'site:jobs.jobvite.com',
    'site:bamboohr.com',
    'site:recruiting.ultipro.com',
  ].join(' OR ');
}
