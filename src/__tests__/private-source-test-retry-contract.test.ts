import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const runner = readFileSync('scripts/run-private-source-test.ts', 'utf8');

describe('private source validation transient retry contract', () => {
  it('retries a bounded number of transient infrastructure failures', () => {
    expect(runner).toContain('MAX_TRANSIENT_ATTEMPTS = 3');
    expect(runner).toContain('TRANSIENT_ERROR_PATTERN');
    expect(runner).toContain('gateway timeout');
    expect(runner).toContain('service unavailable');
    expect(runner).toContain('waitBeforeRetry');
  });

  it('does not turn retries into publication authority', () => {
    expect(runner).toContain('privateTest: true');
    expect(runner).toContain('runClaimedFetch');
    expect(runner).not.toContain('decide_opportunity_review');
    expect(runner).not.toContain('public_safe');
  });

  it('uses a distinct worker id for each retry attempt', () => {
    expect(runner).toContain('GITHUB_RUN_ATTEMPT');
    expect(runner).toContain('${workflowRunId}:${workflowAttempt}:${attempt}');
    expect(runner).toContain('transientAttempt: attempt');
  });
});
