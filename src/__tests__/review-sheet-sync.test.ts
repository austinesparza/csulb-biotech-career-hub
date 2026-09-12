import { describe, expect, it } from 'vitest';
import {
  buildReviewSheetRow,
  planResolvedRowArchive,
  planReviewSheetSync,
  REVIEW_QUEUE_HEADERS,
  type ReviewSheetCandidate,
} from '../lib/review-sheet-sync';
import type { SheetSnapshot } from '../lib/google-sheets';

const headers = [...REVIEW_QUEUE_HEADERS];

function candidate(overrides: Partial<ReviewSheetCandidate> = {}): ReviewSheetCandidate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Computational Biology Intern',
    posting_url: 'https://example.org/jobs/1',
    location: 'California',
    eligibility: "Current master's student",
    focus_area: 'Computational biology',
    scientific_lanes: ['Computational Biology'],
    deadline: '2026-10-31',
    deadline_text: null,
    application_type: 'internship',
    source_status_raw: 'Open',
    relevance_score: 80,
    audience_bucket: 'graduate',
    audience_reason: "Posting explicitly accepts master's students.",
    eligibility_evidence: "Posting explicitly accepts master's students.",
    continued_enrollment_required: true,
    work_authorization: 'US work authorization required',
    application_opened_at: '2026-09-01',
    last_checked_at: '2026-09-11T12:00:00Z',
    source_check_result: 'open',
    first_seen_at: '2026-09-01T12:00:00Z',
    companies: { name: 'Example Bio' },
    ...overrides,
  };
}

function snapshot(rows: string[][]): SheetSnapshot {
  return {
    rows: [headers, ...rows],
    range: "'Review Queue'!A1:Z500",
    rowCount: rows.length,
    columnCount: 26,
  };
}

describe('machine review queue to Sheet planning', () => {
  it('builds the exact review contract and neutral officer decision cells', () => {
    const row = buildReviewSheetRow(candidate());
    expect(row).toHaveLength(26);
    expect(row[0]).toBe('AUTO-11111111');
    expect(row[18]).toBe('https://example.org/jobs/1');
    expect(row[19]).toBe('2026-09-11');
    expect(row[21]).toBe('');
    expect(row[22]).toBe('FALSE');
    expect(row[23]).toBe(candidate().id);
  });

  it('escapes formula-leading source text', () => {
    const row = buildReviewSheetRow(candidate({ title: '=IMPORTXML("https://bad.example")' }));
    expect(row[4]).toBe('\'=IMPORTXML("https://bad.example")');
  });

  it('appends a new machine candidate', () => {
    const plan = planReviewSheetSync(snapshot([]), [candidate()]);
    expect(plan.appended).toBe(1);
    expect(plan.updates).toEqual([{
      range: "'Review Queue'!A2:Z2",
      values: [buildReviewSheetRow(candidate())],
    }]);
  });

  it('links a matching officer row without overwriting officer-owned columns', () => {
    const manual = Array(26).fill('');
    manual[0] = 'CAND-2026-0001';
    manual[18] = candidate().posting_url!;
    manual[20] = 'Keep this officer note';
    manual[21] = 'Approve';
    manual[22] = 'TRUE';

    const plan = planReviewSheetSync(snapshot([manual]), [candidate()]);
    expect(plan.linked).toBe(1);
    expect(plan.appended).toBe(0);
    expect(plan.updates).toEqual([{
      range: "'Review Queue'!X2:X2",
      values: [[candidate().id]],
    }]);
  });

  it('links equivalent URLs with trailing slashes and tracking parameters', () => {
    const manual = Array(26).fill('');
    manual[0] = 'CAND-2026-0001';
    manual[18] = 'https://EXAMPLE.org/jobs/1/?utm_source=sheet#details';

    const plan = planReviewSheetSync(snapshot([manual]), [candidate()]);
    expect(plan.linked).toBe(1);
    expect(plan.appended).toBe(0);
    expect(plan.updates).toEqual([{
      range: "'Review Queue'!X2:X2",
      values: [[candidate().id]],
    }]);
  });

  it('writes into a preformatted checkbox row instead of below the configured range', () => {
    const unusedTemplateRow = Array(23).fill('');
    unusedTemplateRow[22] = 'FALSE';
    const plan = planReviewSheetSync(snapshot([unusedTemplateRow]), [candidate()]);
    expect(plan.appended).toBe(1);
    expect(plan.updates[0].range).toBe("'Review Queue'!A2:Z2");
  });

  it('fails visibly when the configured queue range has no reusable row', () => {
    const full = snapshot([
      buildReviewSheetRow(candidate({
        id: '22222222-2222-4222-8222-222222222222',
        posting_url: 'https://example.org/jobs/other',
      })),
    ]);
    full.range = "'Review Queue'!A1:Z2";
    expect(() => planReviewSheetSync(full, [candidate()]))
      .toThrow('Review Queue has no empty candidate rows');
  });

  it('does not present first-seen time as a completed source check', () => {
    const row = buildReviewSheetRow(candidate({ last_checked_at: null }));
    expect(row[19]).toBe('Not checked');
  });

  it('selects posting metadata whose canonical URL matches the opportunity', () => {
    const row = buildReviewSheetRow(candidate({
      opportunity_source_links: [
        {
          source_postings: {
            canonical_url: 'https://example.org/jobs/other',
            external_posting_id: 'WRONG',
            remote_type: 'onsite',
            posted_at: '2026-08-01',
          },
        },
        {
          source_postings: {
            canonical_url: 'https://example.org/jobs/1/',
            external_posting_id: 'RIGHT',
            remote_type: 'hybrid',
            posted_at: '2026-09-01',
          },
        },
      ],
    }));
    expect(row[5]).toBe('RIGHT');
    expect(row[9]).toBe('hybrid');
  });

  it('refreshes only system columns for rows previously created by automation', () => {
    const automated = buildReviewSheetRow(candidate({ title: 'Old title' }));
    automated[20] = 'Officer note';
    automated[21] = 'Hold';
    automated[22] = 'TRUE';

    const plan = planReviewSheetSync(snapshot([automated]), [candidate({ title: 'New title' })]);
    expect(plan.refreshed).toBe(1);
    expect(plan.updates).toHaveLength(2);
    expect(plan.updates[0].range).toBe("'Review Queue'!A2:T2");
    expect(plan.updates[0].values[0][4]).toBe('New title');
    expect(plan.updates[1]).toEqual({
      range: "'Review Queue'!X2:X2",
      values: [[candidate().id]],
    });
    expect(plan.updates.some((update) => /[UVW]/.test(update.range))).toBe(false);
  });

  it('moves finalized rows to Archive exactly once and deletes bottom-up', () => {
    const approved = buildReviewSheetRow(candidate());
    approved[21] = 'Approve';
    approved[22] = 'TRUE';
    const rejected = buildReviewSheetRow(candidate({ id: '22222222-2222-4222-8222-222222222222' }));
    rejected[21] = 'Reject';
    const review = snapshot([approved, rejected]);
    const archive = { ...snapshot([]), range: "'Archive'!A1:Z5000" };
    const plan = planResolvedRowArchive(review, archive, [
      { id: candidate().id, status: 'open_verified', review_status: 'approved', public_safe: true },
      { id: '22222222-2222-4222-8222-222222222222', status: 'not_relevant', review_status: 'rejected', public_safe: false },
    ]);
    expect(plan.archived).toBe(2);
    expect(plan.deleteRowNumbers).toEqual([3, 2]);
    expect(plan.appendRows[0][1]).toBe('Approved');
    expect(plan.appendRows[0][22]).toBe('TRUE');
    expect(plan.appendRows[1][1]).toBe('Rejected');
    expect(plan.appendRows[1][22]).toBe('FALSE');
  });

  it('deletes a resolved queue row without duplicating an existing archive row', () => {
    const row = buildReviewSheetRow(candidate());
    const review = snapshot([row]);
    const archive = { ...snapshot([row]), range: "'Archive'!A1:Z5000" };
    const plan = planResolvedRowArchive(review, archive, [
      { id: candidate().id, status: 'open_verified', review_status: 'approved', public_safe: true },
    ]);
    expect(plan).toMatchObject({ archived: 0, alreadyArchived: 1, deleteRowNumbers: [2] });
    expect(plan.appendRows).toEqual([]);
  });
});
