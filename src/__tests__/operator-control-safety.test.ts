import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceActions = readFileSync('src/app/admin/sources/actions.ts', 'utf8');
const sourcePage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');
const sourceRunner = readFileSync('src/lib/ingestion/source-runner.ts', 'utf8');
const ingestRoute = readFileSync('src/app/api/cron/ingest/route.ts', 'utf8');
const healthRoute = readFileSync('src/app/api/cron/health/route.ts', 'utf8');
const integrationPage = readFileSync('src/app/admin/integrations/page.tsx', 'utf8');
const adminPage = readFileSync('src/app/admin/page.tsx', 'utf8');
const importPage = readFileSync('src/app/admin/import/page.tsx', 'utf8');
const sheetSync = readFileSync('src/app/admin/import/sheet-sync.tsx', 'utf8');
const reviewCard = readFileSync('src/app/admin/review/review-card.tsx', 'utf8');
const manageActions = readFileSync('src/app/admin/manage/actions.ts', 'utf8');

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

  it('reports operational readiness without exposing the cron secret', () => {
    expect(integrationPage).toContain('cronSecret.length >= 32');
    expect(integrationPage).toContain('The secret value is never displayed');
    expect(integrationPage).not.toContain('{cronSecret}');
    expect(integrationPage).toContain('Machine source controls');
    expect(integrationPage).toContain('Officer continuity');
    expect(integrationPage).toContain('Use a reviewed private test before enabling one');
  });

  it('makes the spreadsheet review boundary explicit to officers', () => {
    expect(adminPage).toContain('Spreadsheet to website');
    expect(adminPage).toContain('They never publish by themselves');
    expect(importPage).toContain('Sheet approval is not website approval');
    expect(sheetSync).toContain('This creates private drafts');
    expect(sheetSync).toContain('Review private drafts');
    expect(reviewCard).toContain('Confirm Sheet approval and publish');
    expect(reviewCard).toContain('Review or change imported details');
  });

  it('keeps post-publication corrections behind officer verification', () => {
    expect(adminPage).toContain('Correct published records');
    expect(manageActions.indexOf('await requireOfficer()')).toBeLessThan(manageActions.indexOf('createServiceClient()'));
    expect(manageActions).toContain('validateRevisionReason');
    expect(manageActions).toContain('p_expected_updated_at');
  });
});
