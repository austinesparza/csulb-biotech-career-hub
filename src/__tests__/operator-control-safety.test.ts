import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sourceActions = readFileSync('src/app/admin/sources/actions.ts', 'utf8');
const sourcePage = readFileSync('src/app/admin/sources/page.tsx', 'utf8');
const sourceRunForm = readFileSync('src/app/admin/sources/source-run-form.tsx', 'utf8');
const pipelineRunActions = readFileSync('src/app/admin/sources/pipeline-actions.ts', 'utf8');
const sourceRunner = readFileSync('src/lib/ingestion/source-runner.ts', 'utf8');
const pipelineCycle = readFileSync('src/lib/pipeline-cycle.ts', 'utf8');
const ingestRoute = readFileSync('src/app/api/cron/ingest/route.ts', 'utf8');
const healthRoute = readFileSync('src/app/api/cron/health/route.ts', 'utf8');
const integrationPage = readFileSync('src/app/admin/integrations/page.tsx', 'utf8');
const adminPage = readFileSync('src/app/admin/page.tsx', 'utf8');
const importPage = readFileSync('src/app/admin/import/page.tsx', 'utf8');
const sheetSync = readFileSync('src/app/admin/import/sheet-sync.tsx', 'utf8');
const reviewWorkflowActions = readFileSync('src/app/admin/import/review-workflow-actions.ts', 'utf8');
const sheetReconcileActions = readFileSync('src/app/admin/import/sheet-reconcile-actions.ts', 'utf8');
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
    expect(sourceRunForm).toContain('action="/api/admin/sources/run"');
    expect(sourceRunForm).toContain('method="post"');
    expect(sourceRunForm).not.toContain('useActionState');
    expect(sourcePage).toContain('action="/api/admin/sources/test"');
  });

  it('marks every cron response private and non-cacheable', () => {
    for (const route of [ingestRoute, healthRoute]) {
      expect(route).toContain('Cache-Control');
      expect(route).toContain('private, no-store');
      expect(route).toMatch(/return json\(\{ ok: false, error: ['\"]unauthorized['\"] \}, 401\)/);
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

  it('uses one normal officer pipeline without granting publication authority', () => {
    expect(sourcePage).toContain('Run the career pipeline');
    expect(sourcePage).toContain('PipelineRunForm');
    expect(sourcePage).toContain('Advanced queue-only recovery');
    expect(pipelineRunActions.indexOf('await requireOfficer()')).toBeLessThan(
      pipelineRunActions.indexOf('createServiceClient()'),
    );
    expect(pipelineRunActions).toContain("trigger: 'officer'");
    expect(pipelineRunActions).not.toContain('decide_opportunity_review');
    expect(pipelineCycle).toContain('schedule_due_source_fetch_runs');
    expect(pipelineCycle).toContain('recover_stale_source_fetch_runs');
    expect(pipelineCycle).toContain('runIngestionBatch');
    expect(pipelineCycle).toContain('reconcileReviewableSourcePostings');
    expect(pipelineCycle).toContain('syncReviewQueueToGoogleSheet');
    expect(pipelineCycle).not.toContain('decide_opportunity_review');
    expect(ingestRoute).toContain('runPipelineCycle');
  });

  it('makes the spreadsheet review boundary explicit and bidirectional by default', () => {
    expect(adminPage).toContain('Spreadsheet to website');
    expect(adminPage).toContain('They never publish by themselves');
    expect(importPage).toContain('Sheet approval is not website approval');
    expect(sheetSync).toContain('Sync review workflow');
    expect(sheetSync).toContain('Advanced one-way controls');
    expect(sheetSync).toContain('Pull decisions only');
    expect(sheetSync).toContain('Refresh Sheet only');
    expect(sheetSync).toContain('Publication still requires an authenticated officer confirmation');
    const pullIndex = reviewWorkflowActions.indexOf('await syncGoogleSheet()');
    const pushIndex = reviewWorkflowActions.indexOf('await reconcileAndSyncMachineReviewQueueToSheet()');
    expect(pullIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(pullIndex);
    expect(sheetReconcileActions.indexOf('await requireOfficer()')).toBeLessThan(
      sheetReconcileActions.indexOf('createServiceClient()'),
    );
    expect(sheetReconcileActions).toContain('reconcileReviewableSourcePostings({ db })');
    expect(sheetReconcileActions).toContain('syncReviewQueueToGoogleSheet({ db })');
    expect(importActions).toContain("return { ok: false, error: safeError }");
    expect(importActions).toContain("console.error('[spreadsheet-sync] action failed'");
    expect(reviewCard).toContain('Confirm Sheet approval and publish');
    expect(reviewCard).toContain('Review or change imported details');
    expect(reviewCard).toContain('if (!result.ok)');
    expect(reviewActions).toContain("console.error('[review-action] failed'");
  });

  it('pushes the complete private review queue to the Sheet without owning officer decisions', () => {
    expect(pipelineCycle).toContain('syncReviewQueueToGoogleSheet');
    expect(pipelineCycle).toContain('PIPELINE_SHEET_SYNC_LIMIT ?? 50');
    expect(pipelineCycle).toContain('limit: sheetSyncLimit');
    expect(reviewSheetSync).not.toContain("opportunity_source_links!inner");
    expect(reviewSheetSync).toContain(".eq('status', 'needs_review')");
    expect(reviewSheetSync).toContain(".eq('review_status', 'pending')");
    expect(reviewSheetSync).toContain(".eq('public_safe', false)");
    expect(reviewSheetSync).toContain("candidateId.startsWith('AUTO-')");
    expect(reviewSheetSync).toContain('row.slice(0, 20)');
    expect(reviewSheetSync).toContain('X${byRecord.rowNumber}:X');
    expect(reviewSheetSync).toContain("'Pending'");
    expect(reviewSheetSync).toContain("'FALSE'");
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
    expect(pipelineCycle).toContain('BRAVE_SEARCH_STORAGE_RIGHTS_CONFIRMED');
    expect(pipelineCycle).not.toContain('decide_opportunity_review');
  });

  it('keeps post-publication corrections behind officer verification', () => {
    expect(adminPage).toContain('Correct published records');
    expect(manageActions.indexOf('await requireOfficer()')).toBeLessThan(manageActions.indexOf('createServiceClient()'));
    expect(manageActions).toContain('validateRevisionReason');
    expect(manageActions).toContain('p_expected_updated_at');
  });
});
