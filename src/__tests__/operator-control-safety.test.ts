import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceActions = readFileSync('src/app/admin/sources/actions.ts', 'utf8');
const sourcePage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');
const sourceRunForm = readFileSync('src/app/admin/sources/source-run-form.tsx', 'utf8');
const sourceRunner = readFileSync('src/lib/ingestion/source-runner.ts', 'utf8');
const ingestRoute = readFileSync('src/app/api/cron/ingest/route.ts', 'utf8');
const healthRoute = readFileSync('src/app/api/cron/health/route.ts', 'utf8');
const integrationPage = readFileSync('src/app/admin/integrations/page.tsx', 'utf8');
const adminPage = readFileSync('src/app/admin/page.tsx', 'utf8');
const importPage = readFileSync('src/app/admin/import/page.tsx', 'utf8');
const sheetSync = readFileSync('src/app/admin/import/sheet-sync.tsx', 'utf8');
const importActions = readFileSync('src/app/admin/import/actions.ts', 'utf8');
const reviewSheetSync = readFileSync('src/lib/review-sheet-sync.ts', 'utf8');
const googleSheets = readFileSync('src/lib/google-sheets.ts', 'utf8');
const reviewCard = readFileSync('src/app/admin/review/review-card.tsx', 'utf8');
const reviewActions = readFileSync('src/app/admin/review/actions.ts', 'utf8');
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

  it('adds curated starter feeds only as disabled unreviewed sources', () => {
    expect(sourceActions).toContain('createStarterSource');
    expect(sourceActions).toContain('enabled: false');
    expect(sourceActions).toContain('terms_reviewed: false');
    expect(sourceActions).toContain('robots_reviewed: false');
    expect(sourcePage).toContain('Add disabled source');
    expect(sourcePage).toContain('Save disabled source');
    expect(sourcePage).toContain('run one private test');
    expect(sourcePage).toContain('Latest private test:');
    expect(sourcePage).toContain('Open review queue');
    expect(sourcePage).toContain('SourceRunForm');
    expect(sourceRunForm).toContain('useActionState');
    expect(sourceRunForm).toContain("state.status === 'error'");
    expect(sourceActions).toContain("console.info(\"[source-run] fetch record created\"");
    expect(sourceActions).toContain("console.error(\"[source-run] action failed\"");
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
    expect(sheetSync).toContain('Sync existing discoveries to Sheet');
    expect(sheetSync).toContain('Pull decisions from Sheet');
    expect(sheetSync).toContain('It does not search employers');
    expect(sheetSync).toContain('/admin/sources');
    expect(sheetSync).toContain('Neither direction publishes automatically');
    expect(sheetSync).toContain('Confirm decisions and publish');
    expect(importActions).toContain("return { ok: false, error: safeError }");
    expect(importActions).toContain("console.error('[spreadsheet-sync] action failed'");
    expect(reviewCard).toContain('Confirm Sheet approval and publish');
    expect(reviewCard).toContain('Review or change imported details');
    expect(reviewCard).toContain('if (!result.ok)');
    expect(reviewActions).toContain("console.error('[review-action] failed'");
  });

  it('pushes governed discoveries to the Sheet without owning officer decisions', () => {
    expect(ingestRoute).toContain('syncReviewQueueToGoogleSheet');
    expect(ingestRoute).toContain('sheetSyncFailed');
    expect(ingestRoute).toContain('PIPELINE_SHEET_SYNC_LIMIT ?? 50');
    expect(ingestRoute).toContain('limit: sheetSyncLimit');
    expect(ingestRoute).not.toContain('syncReviewQueueToGoogleSheet({ db, limit })');
    expect(reviewSheetSync).toContain("opportunity_source_links!inner");
    expect(reviewSheetSync).toContain(".eq('source_record_id', config.sourceRecordId)");
    expect(reviewSheetSync).toContain("candidateId.startsWith('AUTO-')");
    expect(reviewSheetSync).toContain('row.slice(0, 20)');
    expect(reviewSheetSync).toContain('X${byRecord.rowNumber}:X');
    expect(googleSheets).toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(googleSheets).toContain("valueInputOption: 'RAW'");
    expect(googleSheets).toContain("insertDataOption', 'INSERT_ROWS'");
  });

  it('keeps search discovery private and gated by provider storage rights', () => {
    const action = sourceActions.slice(sourceActions.indexOf('export async function runEmployerDiscoveryNow'));
    expect(action.indexOf('await requireOfficer()')).toBeLessThan(action.indexOf('createServiceClient()'));
    expect(action).toContain('BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED');
    expect(sourcePage).toContain('Search provider not configured');
    expect(sourcePage).toContain('private lead archive');
    expect(ingestRoute).toContain('BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED');
    expect(ingestRoute).not.toContain('decide_opportunity_review');
  });

  it('keeps post-publication corrections behind officer verification', () => {
    expect(adminPage).toContain('Correct published records');
    expect(manageActions.indexOf('await requireOfficer()')).toBeLessThan(manageActions.indexOf('createServiceClient()'));
    expect(manageActions).toContain('validateRevisionReason');
    expect(manageActions).toContain('p_expected_updated_at');
  });
});
