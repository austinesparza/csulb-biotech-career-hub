import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildReviewSheetRow, type ReviewSheetCandidate } from '../lib/review-sheet-sync';

function candidate(overrides: Partial<ReviewSheetCandidate> = {}): ReviewSheetCandidate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Research Intern',
    posting_url: 'https://example.org/jobs/1',
    location: 'California',
    eligibility: 'Current undergraduate student',
    focus_area: 'Research',
    scientific_lanes: ['Genomics and genetics'],
    deadline: null,
    deadline_text: null,
    application_type: 'Internship',
    source_status_raw: 'open',
    relevance_score: 70,
    audience_bucket: 'undergraduate',
    audience_reason: 'Official posting requires current undergraduate enrollment.',
    eligibility_evidence: 'Official posting requires current undergraduate enrollment.',
    continued_enrollment_required: true,
    work_authorization: null,
    application_opened_at: null,
    last_checked_at: '2026-09-14T12:00:00Z',
    source_check_result: 'open',
    first_seen_at: '2026-09-14T12:00:00Z',
    companies: { name: 'Example Bio' },
    ...overrides,
  };
}

describe('Review Sheet completeness', () => {
  it('labels undergraduate candidates correctly and starts with a neutral Pending decision', () => {
    const row = buildReviewSheetRow(candidate());
    expect(row[13]).toBe('Undergraduate only');
    expect(row[21]).toBe('Pending');
    expect(row[22]).toBe('FALSE');
  });

  it('does not require an opportunity_source_link before a private candidate reaches the Sheet', () => {
    const source = readFileSync(new URL('../lib/review-sheet-sync.ts', import.meta.url), 'utf8');
    expect(source).toContain(".eq('status', 'needs_review')");
    expect(source).toContain(".eq('review_status', 'pending')");
    expect(source).toContain(".eq('public_safe', false)");
    expect(source).not.toContain('opportunity_source_links!inner');
  });
});
