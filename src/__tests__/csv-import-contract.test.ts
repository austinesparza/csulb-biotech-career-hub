import { describe, expect, it } from 'vitest';
import { mapHeaders, rowToDraft } from '../lib/csvImport';

const OFFICER_REVIEW_HEADERS = [
  'Candidate ID', 'Review Status', 'Event Type', 'Employer', 'Role Title', 'Requisition',
  'Career Area', 'Program Type', 'Location', 'Work Pattern', 'Posted Date', 'Stated Close Date',
  'Open Status', 'Graduate Access', 'Year / Program Requirement', 'Continued Enrollment',
  'Work Authorization', 'Key Evidence', 'Source URL', 'Last Checked', 'Officer Notes',
  'Publish Decision', 'Public Safe?', 'Supabase Record ID', 'GitHub Issue / PR', 'Reviewer',
];

describe('officer workbook import contract', () => {
  it('maps evidence fields but never maps Sheet publication controls', () => {
    const { mapping, unmatched } = mapHeaders(OFFICER_REVIEW_HEADERS);
    expect(mapping).toMatchObject({
      company_name: 'Employer',
      title: 'Role Title',
      posting_url: 'Source URL',
      location: 'Location',
      eligibility: 'Year / Program Requirement',
      focus_area: 'Career Area',
      deadline: 'Stated Close Date',
      application_type: 'Program Type',
      source_status_raw: 'Open Status',
      notes: 'Officer Notes',
      date_added: 'Posted Date',
      candidate_id: 'Candidate ID',
      requisition: 'Requisition',
      work_pattern: 'Work Pattern',
      graduate_access: 'Graduate Access',
      continued_enrollment: 'Continued Enrollment',
      work_authorization: 'Work Authorization',
      key_evidence: 'Key Evidence',
      last_checked: 'Last Checked',
    });
    expect(mapping).not.toHaveProperty('paid_status');
    expect(unmatched).toEqual(expect.arrayContaining(['Publish Decision', 'Public Safe?', 'Reviewer']));
  });

  it('converts a current Review Queue row to a private draft', () => {
    const { mapping } = mapHeaders(OFFICER_REVIEW_HEADERS);
    const raw = Object.fromEntries(OFFICER_REVIEW_HEADERS.map((header) => [header, ''])) as Record<string, string>;
    Object.assign(raw, {
      Employer: 'Example Bio',
      'Role Title': 'Genomics Intern',
      'Source URL': 'https://example.org/jobs/1',
      Location: 'Irvine, CA',
      'Year / Program Requirement': "Master's students eligible",
      'Career Area': 'Genomics',
      'Stated Close Date': '2027-01-15',
      'Open Status': 'Open',
      'Officer Notes': 'Verify continued enrollment.',
      'Candidate ID': 'CAND-2027-0042',
      Requisition: 'R-12345',
      'Work Pattern': 'Hybrid',
      'Graduate Access': 'Explicit',
      'Continued Enrollment': 'Required',
      'Work Authorization': 'US authorization required',
      'Key Evidence': "Posting explicitly names master's students.",
      'Last Checked': '2026-09-10',
      'Publish Decision': 'Approve',
      'Public Safe?': 'TRUE',
    });
    const result = rowToDraft(raw, mapping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({
      companyName: 'Example Bio',
      title: 'Genomics Intern',
      posting_url: 'https://example.org/jobs/1',
      eligibility: "Master's students eligible",
      source_status_raw: 'Open',
    });
    expect(result.draft.private_notes).toBe([
      'Verify continued enrollment.',
      'Candidate ID: CAND-2027-0042',
      'Requisition: R-12345',
      'Work pattern: Hybrid',
      'Graduate access: Explicit',
      'Continued enrollment: Required',
      'Work authorization: US authorization required',
      "Key evidence: Posting explicitly names master's students.",
      'Last checked: 2026-09-10',
    ].join('\n'));
    expect(result.draft).not.toHaveProperty('review_status');
    expect(result.draft).not.toHaveProperty('public_safe');
  });
});
