import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceActions = readFileSync('src/app/admin/sources/actions.ts', 'utf8');
const sourcePage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');
const sourceRunner = readFileSync('src/lib/ingestion/source-runner.ts', 'utf8');
const ingestRoute = readFileSync('src/app/api/cron/ingest/route.ts', 'utf8');
const healthRoute = readFileSync('src/app/api/cron/health/route.ts', 'utf8');

describe('operator control safety', () => {
  it('marks private source tests and does not activate source health', () => {
    expect(sourceActions).toContain('log_json: { privateTest: true');
    expect(sourceActions).toContain('privateTest: true');
    expect(sourcePage).toContain('Test privately');
    expect(sourcePage).toContain('do not enable scheduling, change source health, or publish anything');
    expect(sourceRunner).toContain('new SourceTierStore(db, source, !privateTest)');
    expect(sourceRunner).toContain('if (this.persistChanges)');
  });

  it('marks every cron response private and non-cacheable', () => {
    for (const route of [ingestRoute, healthRoute]) {
      expect(route).toContain('"Cache-Control": "private, no-store"');
      expect(route).toContain('return json({ ok: false, error: "unauthorized" }, 401)');
      expect(route).not.toContain('NextResponse.json({ ok: false, error: "unauthorized" }');
    }
  });
});
