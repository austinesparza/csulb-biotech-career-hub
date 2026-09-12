import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  normalizeOpportunityAudienceFilter,
  isPublishableAudienceStage,
  opportunityAudienceLabel,
  opportunityMatchesAudience,
} from '../lib/opportunityAudience';
import type { PublicOpportunity } from '../lib/types';

const audienceMigration = readFileSync(
  'supabase/migrations/20260912232000_expand_student_audiences.sql',
  'utf8',
);

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

describe('opportunity audience filters', () => {
  it('accepts only supported audience query values', () => {
    expect(normalizeOpportunityAudienceFilter('undergraduate')).toBe('undergraduate');
    expect(normalizeOpportunityAudienceFilter('graduate')).toBe('graduate');
    expect(normalizeOpportunityAudienceFilter('everyone')).toBeUndefined();
  });

  it('includes mixed opportunities in both student views', () => {
    expect(opportunityMatchesAudience({ audience_bucket: 'mixed' }, 'undergraduate')).toBe(true);
    expect(opportunityMatchesAudience({ audience_bucket: 'mixed' }, 'graduate')).toBe(true);
    expect(opportunityMatchesAudience({ audience_bucket: 'undergraduate' }, 'graduate')).toBe(false);
    expect(opportunityMatchesAudience({ audience_bucket: 'graduate' }, 'undergraduate')).toBe(false);
  });

  it('pairs undergraduate and graduate audiences with supported stages', () => {
    expect(isPublishableAudienceStage('undergraduate', 'not_msc')).toBe(true);
    expect(isPublishableAudienceStage('undergraduate', 'msc_any')).toBe(false);
    expect(isPublishableAudienceStage('graduate', 'msc_any')).toBe(true);
    expect(isPublishableAudienceStage('mixed', 'graduate_unspecified')).toBe(true);
    expect(isPublishableAudienceStage('special', 'not_msc')).toBe(false);
  });

  it('keeps database publication and corrections aligned with the UI boundary', () => {
    expect(audienceMigration).toContain("p_audience_bucket = 'undergraduate'");
    expect(audienceMigration).toContain("o.audience_bucket = 'undergraduate'");
    expect(audienceMigration).toContain("v_opportunity.audience_bucket = 'undergraduate'");
    expect(audienceMigration).toContain('uq_opportunity_source_links_source_posting');
  });
});
