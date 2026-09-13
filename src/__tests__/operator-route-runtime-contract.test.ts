import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pipelineRoute = readFileSync('src/app/api/admin/pipeline/run/route.ts', 'utf8');
const queueRoute = readFileSync('src/app/api/admin/pipeline/queue/route.ts', 'utf8');
const pipelineForm = readFileSync('src/app/admin/sources/pipeline-run-form.tsx', 'utf8');
const queueForm = readFileSync('src/app/admin/sources/queue-drain-form.tsx', 'utf8');
const sourceRunRoute = readFileSync('src/app/api/admin/sources/run/route.ts', 'utf8');
const sourceTestRoute = readFileSync('src/app/api/admin/sources/test/route.ts', 'utf8');
const sourceRunForm = readFileSync('src/app/admin/sources/source-run-form.tsx', 'utf8');
const sourcesPage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');

describe('browser-native operator pipeline controls', () => {
  it('authenticates before constructing privileged clients', () => {
    for (const route of [pipelineRoute, queueRoute, sourceRunRoute, sourceTestRoute]) {
      expect(route.indexOf('await requireOfficer()')).toBeGreaterThan(-1);
      expect(route.indexOf('await requireOfficer()')).toBeLessThan(route.indexOf('createServiceClient()'));
      expect(route).toContain("export const maxDuration = 300");
    }
  });

  it('keeps both controls on the canonical private pipeline service', () => {
    expect(pipelineRoute).toContain('runPipelineCycle');
    expect(pipelineRoute).toContain("trigger: 'officer'");
    expect(queueRoute).toContain('runPipelineCycle');
    expect(queueRoute).toContain("trigger: 'queue_recovery'");
    expect(queueRoute).toContain('scheduleDueSources: false');
    expect(queueRoute).toContain('runDiscovery: false');
    expect(queueRoute).toContain('runExtraction: false');
    expect(pipelineRoute).not.toContain('decide_opportunity_review');
    expect(queueRoute).not.toContain('decide_opportunity_review');
  });

  it('uses ordinary authenticated POST navigation instead of Server Action transport', () => {
    expect(pipelineForm).toContain('action="/api/admin/pipeline/run"');
    expect(pipelineForm).toContain('method="post"');
    expect(queueForm).toContain('action="/api/admin/pipeline/queue"');
    expect(queueForm).toContain('method="post"');
    expect(pipelineForm).not.toContain('useActionState');
    expect(queueForm).not.toContain('useActionState');
    expect(sourceRunForm).toContain('action="/api/admin/sources/run"');
    expect(sourceRunForm).toContain('method="post"');
    expect(sourceRunForm).not.toContain('useActionState');
    expect(sourcesPage).toContain('action="/api/admin/sources/test"');
    expect(sourcesPage).toContain('method="post"');
    expect(sourcesPage).not.toContain('action={testSourceNow}');
  });

  it('keeps manual source execution private and preserves private-test isolation', () => {
    expect(sourceRunRoute).toContain('runClaimedFetch');
    expect(sourceRunRoute).toContain('googleSheetsConfigured');
    expect(sourceRunRoute).not.toContain('decide_opportunity_review');
    expect(sourceTestRoute).toContain('runClaimedFetch');
    expect(sourceTestRoute).toContain('privateTest: true');
    expect(sourceTestRoute).not.toContain('syncReviewQueueToGoogleSheet');
    expect(sourceTestRoute).not.toContain('decide_opportunity_review');
  });

  it('labels server-rendered operational timestamps explicitly as UTC', () => {
    expect(sourcesPage).toContain('timeZone: "UTC"');
    expect(sourcesPage).toContain('} UTC`');
    expect(sourcesPage).not.toContain('new Date(value).toLocaleString()');
  });
});
