import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pipelineRoute = readFileSync('src/app/api/admin/pipeline/run/route.ts', 'utf8');
const queueRoute = readFileSync('src/app/api/admin/pipeline/queue/route.ts', 'utf8');
const pipelineForm = readFileSync('src/app/admin/sources/pipeline-run-form.tsx', 'utf8');
const queueForm = readFileSync('src/app/admin/sources/queue-drain-form.tsx', 'utf8');

describe('browser-native operator pipeline controls', () => {
  it('authenticates before constructing privileged clients', () => {
    for (const route of [pipelineRoute, queueRoute]) {
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
  });
});
