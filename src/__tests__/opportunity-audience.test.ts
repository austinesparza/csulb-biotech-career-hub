import { describe, expect, it } from 'vitest';
import { opportunityAudienceLabel } from '../lib/opportunityAudience';
import type { PublicOpportunity } from '../lib/types';

function opportunity(overrides: Partial<PublicOpportunity>): PublicOpportunity {
  return {
    id: 'role-1',
    company_name: 'Example Institute',
    title: 'Research Intern',
    posting_url: 'https://example.org/jobs/1',
    location: null,
    eligibility: null,
    focus_area: null,
    deadline: null,
    deadline_text: null,
    start_date_text: null,
    paid_status: 'unknown',
    application_type: null,
    status: 'open_verified',
    public_notes: null,
    relevance_score: 70,
    last_checked_at: null,
    first_seen_at: '2026-09-12T00:00:00.000Z',
    source_name: 'Employer posting',
    audience_bucket: 'unknown',
    audience_reason: null,
    scientific_lanes: [],
    job_functions: [],
    methods: [],
    industry_context: [],
    graduate_stage: 'unknown',
    ...overrides,
  };
}

describe('public opportunity audience labels', () => {
  it('uses explicit mixed evidence even when a legacy row was classified graduate', () => {
    expect(opportunityAudienceLabel(opportunity({
      audience_bucket: 'graduate',
      graduate_stage: 'graduate_unspecified',
      eligibility: "Current undergraduate, post-baccalaureate, or master's student",
    }))).toBe('Undergraduate, post-baccalaureate, and graduate students');
  });

  it('uses audience buckets before graduate-stage fallbacks', () => {
    expect(opportunityAudienceLabel(opportunity({ audience_bucket: 'undergraduate' })))
      .toBe('Undergraduate students');
    expect(opportunityAudienceLabel(opportunity({ audience_bucket: 'mixed' })))
      .toBe('Undergraduate and graduate students');
  });
});
