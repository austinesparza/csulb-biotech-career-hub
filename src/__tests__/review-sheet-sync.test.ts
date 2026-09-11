import { describe, expect, it } from 'vitest';
import {
  buildReviewSheetRow,
  planReviewSheetSync,
  type ReviewSheetCandidate,
} from '../lib/review-sheet-sync';
import type { SheetSnapshot } from '../lib/google-sheets';

const headers = [
  'Candidate ID', 'Review Status', 'Event Type', 'Employer', 'Role Title',
  'Requisition', 'Career Area', 'Program Type', 'Location', 'Work Pattern',
  'Posted Date', 'Stated Close Date', 'Open Status', 'Graduate Access',
  'Year / Program Requirement', 'Continued Enrollment', 'Work Authorization',
  'Key Evidence', 'Source URL', 'Last Checked', 'Officer Notes',
  'Publish Decision', 'Public Safe?', 'Supabase Record ID', 'GitHub Issue / PR',
];

function candidate(overrides: Partial<ReviewSheetCandidate> = {}): ReviewSheetCandidate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Computational Biology Intern',
    posting_url: 'https://example.org/jobs/1',
    location: 'California',
    eligibility: "Current master's student",
    focus_area: 'Computational biology',
    deadline: '2026-10-31',
    deadline_text: null,
    application_type: 'internship',
    source_status_raw: 'Open',
    relevance_score: 80,
    audience_bucket: 'graduate',
    audience_reason: "Posting explicitly accepts master's students.",
    companies: { name: 'Example Bio' },
    ...overrides,
  };
}

function snapshot(rows: string[][]): SheetSnapshot {
  return {
    rows: [headers, ...rows],
    range: "'Review Queue'!A1:Y500",
    rowCount: rows.length,
    columnCount: 25,
  };
}

describe('machine review queue to Sheet planning', () => {
  it('builds the exact review contract and neutral officer decision cells', () => {
    const row = buildReviewSheetRow(candidate(), new Date('2026-09-11T12:00:00Z'));
    expect(row).toHaveLength(25);
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
    expect(plan.appendRows[0][23]).toBe(candidate().id);
    expect(plan.updates).toEqual([]);
  });

  it('links a matching officer row without overwriting officer-owned columns', () => {
    const manual = Array(25).fill('');
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
});
