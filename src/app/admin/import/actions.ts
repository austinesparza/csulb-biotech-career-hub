'use server';
// CSV import pipeline (Deliverable G, server side).
// upload → import_run → raw rows → normalize → dedupe → upsert as needs_review.
//
// Invariants enforced here (audit patches 2 & 3):
//   - every import REQUIRES a source_record_id (provenance is mandatory)
//   - approved+public records are never field-mutated: last_seen_at only,
//     with an import_changed review task if public-facing fields differ.

import Papa from 'papaparse';
import { mapHeaders, rowToDraft } from '@/lib/csvImport';
import {
  changedFlaggedFields,
  decideUpdatePolicy,
  matchCompany,
  matchOpportunity,
  type ExistingOpportunity,
} from '@/lib/dedupe';
import { normalizeCompanyName } from '@/lib/normalize';
import { scoreOpportunity } from '@/lib/relevance';
import { fetchGoogleSheet, readGoogleSheetsConfig } from '@/lib/google-sheets';
import { syncReviewQueueToGoogleSheet, type ReviewSheetSyncSummary } from '@/lib/review-sheet-sync';
import { filterMeaningfulReviewRows } from '@/lib/sheet-review';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';

export interface ImportSummary {
  importRunId: string;
  totalRows: number;
  inserted: number;
  updated: number;        // fields updated (non-public records)
  touched: number;        // approved+public: last_seen_at only
  changeFlags: number;    // import_changed tasks on approved records
  duplicatesFlagged: number;
  errors: Array<{ row: number; message: string }>;
  unmatchedHeaders: string[];
}

export interface GoogleSheetSyncSummary extends ImportSummary {
  sheetRange: string;
  sheetRows: number;
  skippedTemplateRows: number;
}

export type SheetSyncActionResult<T> =
  | { ok: true; summary: T }
  | { ok: false; error: string };

function safeSheetSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';

  if (message === 'Not signed in') {
    return 'Your officer session has expired. Sign in again, then retry the sync.';
  }
  if (message === 'Not an active officer') {
    return 'This account is not an active officer and cannot sync the review Sheet.';
  }
  if (/^Google service-account authentication failed \(\d{3}\)$/.test(message)) {
    return `${message}. Check the production Google service-account configuration.`;
  }
  if (/^Google Sheets (read|metadata read|tab creation|update|append|row deletion) failed \(\d{3}\)$/.test(message)) {
    return `${message}. Confirm that the configured service account has Editor access to the review Sheet.`;
  }
  if (message.startsWith('Review Queue ') || message.startsWith('Archive ')) {
    return message;
  }
  if (message === 'The configured Google Sheet source record does not exist.') {
    return message;
  }

  return 'Spreadsheet sync failed before completion. No record was published. Check the production runtime log for the safe server-side diagnostic.';
}

async function runSheetSyncAction<T>(
  operation: 'push' | 'pull',
  run: () => Promise<T>,
): Promise<SheetSyncActionResult<T>> {
  try {
    return { ok: true, summary: await run() };
  } catch (error) {
    const safeError = safeSheetSyncError(error);
    console.error('[spreadsheet-sync] action failed', { operation, error: safeError });
    return { ok: false, error: safeError };
  }
}

/** Columns loaded for dedupe + safe-update comparison. */
const EXISTING_COLUMNS =
  'id, dedupe_key, family_key, posting_url, title, company_id, review_status, public_safe, ' +
  'location, eligibility, focus_area, deadline, deadline_text, paid_status, application_type, source_status_raw, ' +
  'eligibility_evidence, continued_enrollment_required, work_authorization, application_opened_at, ' +
  'last_checked_at, source_check_result';

type ExistingRow = ExistingOpportunity & Record<string, unknown>;

export async function importCsv(formData: FormData): Promise<ImportSummary> {
  const { user } = await requireOfficer();
  const file = formData.get('file') as File | null;
  const sourceRecordId = (formData.get('source_record_id') as string) || null;
  if (!file) throw new Error('No file uploaded');
  if (!sourceRecordId) {
    throw new Error('A source record is required for CSV imports. Pick one (e.g. "Club Internship Spreadsheet") or create it under Sources first.');
  }
  return importCsvText({
    text: await file.text(),
    filename: file.name,
    sourceRecordId,
    uploadedBy: user.id,
  });
}

async function importCsvText(input: {
  text: string;
  filename: string;
  sourceRecordId: string;
  uploadedBy: string;
}): Promise<ImportSummary> {
  const db = createServiceClient();
  const { text, filename, sourceRecordId, uploadedBy } = input;
  const { data: source } = await db.from('source_records').select('id').eq('id', sourceRecordId).maybeSingle();
  if (!source) throw new Error('Unknown source record.');

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
  });
  const headers = parsed.meta.fields ?? [];
  const { mapping, unmatched } = mapHeaders(headers);
  if (!mapping.company_name || !mapping.title) {
    throw new Error(
      `Could not find required columns. Matched: ${JSON.stringify(mapping)}. ` +
      `Rename headers or extend HEADER_ALIASES in src/lib/csvImport.ts.`,
    );
  }

  const { data: run, error: runErr } = await db
    .from('import_runs')
    .insert({
      source_record_id: sourceRecordId,
      filename,
      uploaded_by: uploadedBy,
      total_rows: parsed.data.length,
    })
    .select('id')
    .single();
  if (runErr || !run) throw new Error(`Failed to create import run: ${runErr?.message}`);

  try {
  // Load existing data once (club scale: fine).
  const { data: companies } = await db.from('companies').select('id, name, name_normalized');
  const { data: opportunities } = await db.from('opportunities').select(EXISTING_COLUMNS);
  const existingCompanies = companies ?? [];
  const existingOpps = (opportunities ?? []) as unknown as ExistingRow[];

  const summary: ImportSummary = {
    importRunId: run.id, totalRows: parsed.data.length,
    inserted: 0, updated: 0, touched: 0, changeFlags: 0,
    duplicatesFlagged: 0, errors: [], unmatchedHeaders: unmatched,
  };

  for (let i = 0; i < parsed.data.length; i++) {
    const rowNumber = i + 2; // 1-based + header row
    const raw = parsed.data[i];
    const result = rowToDraft(raw, mapping);

    const rawRow = {
      import_run_id: run.id,
      row_number: rowNumber,
      raw,
      parse_status: result.ok ? ('ok' as const) : ('error' as const),
      error_message: result.ok ? null : result.error,
      matched_opportunity_id: null as string | null,
    };

    if (!result.ok) {
      summary.errors.push({ row: rowNumber, message: result.error });
      await db.from('raw_import_rows').insert(rawRow);
      continue;
    }
    const draft = result.draft;

    // 1. Company: exact → use; fuzzy → use existing but flag; none → create.
    let companyId: string;
    const cMatch = matchCompany(draft.companyName, existingCompanies);
    if (cMatch.kind === 'none') {
      const { data: newCo, error } = await db
        .from('companies')
        .insert({ name: draft.companyName, name_normalized: normalizeCompanyName(draft.companyName) })
        .select('id')
        .single();
      if (error || !newCo) {
        summary.errors.push({ row: rowNumber, message: `Company insert failed: ${error?.message}` });
        await db.from('raw_import_rows').insert({ ...rawRow, parse_status: 'error', error_message: error?.message });
        continue;
      }
      companyId = newCo.id;
      existingCompanies.push({ id: newCo.id, name: draft.companyName, name_normalized: normalizeCompanyName(draft.companyName) });
    } else {
      companyId = cMatch.companyId;
      if (cMatch.kind === 'fuzzy') {
        await db.from('review_tasks').insert({
          task_type: 'possible_duplicate', entity_table: 'companies', entity_id: companyId,
          notes: `Import row ${rowNumber}: "${draft.companyName}" fuzzy-matched "${cMatch.existingName}" (${cMatch.score.toFixed(2)}). Verify same company.`,
        });
      }
    }

    // 2. Opportunity match (URL → strict key → family → fuzzy).
    const oMatch = matchOpportunity({ ...draft, companyId }, existingOpps);
    const { score, reasons } = scoreOpportunity(draft);

    if (oMatch.kind === 'same_url' || oMatch.kind === 'strict_key') {
      const existing = existingOpps.find((o) => o.id === oMatch.opportunityId)!;
      const policy = decideUpdatePolicy(existing);

      if (policy.mode === 'update_fields') {
        // Not yet public: safe to refresh imported fields.
        await db.from('opportunities')
          .update({
            last_seen_at: new Date().toISOString(),
            posting_url: draft.posting_url ?? existing.posting_url,
            location: draft.location,
            eligibility: draft.eligibility,
            focus_area: draft.focus_area,
            deadline: draft.deadline,
            deadline_text: draft.deadline_text,
            paid_status: draft.paid_status,
            application_type: draft.application_type,
            source_status_raw: draft.source_status_raw,
            audience_bucket: draft.audience_bucket,
            audience_reason: draft.audience_reason,
            graduate_stage: draft.graduate_stage,
            eligibility_evidence: draft.eligibility_evidence ?? existing.eligibility_evidence,
            continued_enrollment_required:
              draft.continued_enrollment_required ?? existing.continued_enrollment_required,
            work_authorization: draft.work_authorization ?? existing.work_authorization,
            application_opened_at: draft.application_opened_at ?? existing.application_opened_at,
            last_checked_at: draft.last_checked_at ?? existing.last_checked_at,
            source_check_result: draft.source_check_result === 'unknown'
              ? existing.source_check_result
              : draft.source_check_result,
            relevance_score: score,
            relevance_reasons: reasons,
          })
          .eq('id', existing.id);
        summary.updated++;
      } else {
        // Approved + public: NEVER silently mutate. Touch last_seen_at only;
        // flag any public-facing differences for an officer.
        await db.from('opportunities')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', existing.id);
        summary.touched++;
        const changed = changedFlaggedFields(draft as unknown as Record<string, unknown>, existing);
        if (changed.length > 0) {
          summary.changeFlags++;
          await db.from('review_tasks').insert({
            task_type: 'import_changed', entity_table: 'opportunities', entity_id: existing.id,
            notes: `Import row ${rowNumber} differs from the APPROVED public record in: ${changed.join(', ')}. Review and update manually if the source changed.`,
          });
        }
      }
      await db.from('raw_import_rows').insert({ ...rawRow, matched_opportunity_id: existing.id });
      continue;
    }

    // 3. New row (family/fuzzy matches also insert — they only add a flag).
    const { data: newOpp, error: oErr } = await db
      .from('opportunities')
      .insert({
        company_id: companyId,
        source_record_id: sourceRecordId,
        title: draft.title,
        posting_url: draft.posting_url,
        location: draft.location,
        eligibility: draft.eligibility,
        focus_area: draft.focus_area,
        deadline: draft.deadline,
        deadline_text: draft.deadline_text,
        start_date_text: draft.start_date_text,
        paid_status: draft.paid_status,
        application_type: draft.application_type,
        source_status_raw: draft.source_status_raw,
        audience_bucket: draft.audience_bucket,
        audience_reason: draft.audience_reason,
        graduate_stage: draft.graduate_stage,
        eligibility_evidence: draft.eligibility_evidence,
        continued_enrollment_required: draft.continued_enrollment_required,
        work_authorization: draft.work_authorization,
        application_opened_at: draft.application_opened_at,
        last_checked_at: draft.last_checked_at,
        source_check_result: draft.source_check_result,
        private_notes: draft.private_notes, // imported notes stay private until reviewed
        date_added: draft.date_added,
        status: 'needs_review',
        review_status: 'pending',
        public_safe: false,
        relevance_score: score,
        relevance_reasons: reasons,
        dedupe_key: draft.dedupe_key,
        family_key: draft.family_key,
      })
      .select('id')
      .single();
    if (oErr || !newOpp) {
      summary.errors.push({ row: rowNumber, message: `Insert failed: ${oErr?.message}` });
      await db.from('raw_import_rows').insert({ ...rawRow, parse_status: 'error', error_message: oErr?.message });
      continue;
    }
    summary.inserted++;
    existingOpps.push({
      id: newOpp.id, dedupe_key: draft.dedupe_key, family_key: draft.family_key,
      posting_url: draft.posting_url, title: draft.title, company_id: companyId,
      review_status: 'pending', public_safe: false,
    });
    await db.from('raw_import_rows').insert({ ...rawRow, matched_opportunity_id: newOpp.id });

    if (oMatch.kind === 'family') {
      summary.duplicatesFlagged++;
      await db.from('review_tasks').insert({
        task_type: 'possible_repost', entity_table: 'opportunities', entity_id: newOpp.id,
        notes: `Same posting family as ${oMatch.opportunityId} (title differs only by season/year). Likely a new cycle. Verify, then keep both or mark duplicate.`,
      });
    } else if (oMatch.kind === 'fuzzy') {
      summary.duplicatesFlagged++;
      await db.from('review_tasks').insert({
        task_type: 'possible_duplicate', entity_table: 'opportunities', entity_id: newOpp.id,
        notes: `Similar to existing opportunity ${oMatch.opportunityId} (${oMatch.score.toFixed(2)}).`,
      });
    }
  }

  await db.from('import_runs')
    .update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      inserted_count: summary.inserted,
      updated_count: summary.updated + summary.touched,
      duplicate_count: summary.duplicatesFlagged,
      error_count: summary.errors.length,
    })
    .eq('id', run.id);

  await db.from('source_records')
    .update({ last_imported_at: new Date().toISOString() })
    .eq('id', sourceRecordId);

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Unexpected import failure';
    await db.from('import_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      notes: message,
    }).eq('id', run.id);
    throw error;
  }
}

/**
 * Officer-triggered intake from one configured Sheet range.
 * It deliberately enters through the same raw-row archive and review rules as a
 * CSV upload. The configured Sheet cannot select a different source or set any
 * publication field.
 */
export async function syncGoogleSheet(): Promise<SheetSyncActionResult<GoogleSheetSyncSummary>> {
  return runSheetSyncAction('pull', async () => {
    const { user } = await requireOfficer();
    const config = readGoogleSheetsConfig();

    // Reject a stale/mistyped source binding before making an external request.
    const db = createServiceClient();
    const { data: source, error } = await db.from('source_records')
      .select('id')
      .eq('id', config.sourceRecordId)
      .maybeSingle();
    if (error || !source) throw new Error('The configured Google Sheet source record does not exist.');

    const snapshot = await fetchGoogleSheet(config);
    const filtered = filterMeaningfulReviewRows(snapshot.rows);
    const summary = await importCsvText({
      text: Papa.unparse(filtered.rows),
      filename: `google-sheet-${new Date().toISOString().slice(0, 10)}.csv`,
      sourceRecordId: config.sourceRecordId,
      uploadedBy: user.id,
    });
    return {
      ...summary,
      sheetRange: snapshot.range,
      sheetRows: filtered.candidateRows,
      skippedTemplateRows: filtered.skippedTemplateRows,
    };
  });
}


/**
 * Officer-triggered push of machine-discovered private candidates to the
 * Review Queue tab. System columns are refreshed, officer decision columns are
 * preserved, and no publication field is changed.
 */
export async function syncMachineReviewQueueToSheet(): Promise<SheetSyncActionResult<ReviewSheetSyncSummary>> {
  return runSheetSyncAction('push', async () => {
    await requireOfficer();
    const db = createServiceClient();
    return syncReviewQueueToGoogleSheet({ db });
  });
}
