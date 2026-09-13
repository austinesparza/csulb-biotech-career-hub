import { describe, expect, it } from 'vitest';
import {
  companyContextLine,
  noteLabel,
  opportunityTags,
  postingLinkLabel,
  sourceEvidenceLabel,
  timingFallbackLabel,
} from '../lib/opportunityCard';
import type { PublicOpportunity } from '../lib/types';

function opportunity(overrides: Partial<PublicOpportunity> = {}): PublicOpportunity {
  return {
    id: 'role-1',
    company_name: 'Example Biotech',
    company_website: 'https://example.com/',
    company_location: 'South San Francisco, CA',
    company_industry_tags: ['biotechnology', 'protein design'],
    company_description: 'Example company.',
    title: 'Research Intern',
    posting_url: 'https://careers.example.com/jobs/1',
    location: 'San Francisco, CA',
    eligibility: null,
    focus_area: null,
    deadline: null,
    deadline_text: null,
    start_date_text: null,
    paid_status: 'unknown',
    application_type: null,
    status: 'open_verified',
    public_notes: null,
    relevance_score: 80,
    last_checked_at: null,
    first_seen_at: '2026-09-13T00:00:00.000Z',
    source_name: null,
    audience_bucket: 'graduate',
    audience_reason: null,
    scientific_lanes: [],
    job_functions: [],
    methods: [],
    industry_context: [],
    graduate_stage: 'msc_any',
    ...overrides,
  };
}

describe('opportunity card tags', () => {
  it('prefers controlled scientific lanes over legacy focus-area prose', () => {
    expect(opportunityTags(opportunity({
      focus_area: 'Laboratory automation and scientific software; Biological data science and ML',
      scientific_lanes: [
        'Laboratory automation and scientific software',
        'Biological data science and ML',
      ],
      methods: ['python'],
    }))).toEqual(['Lab automation', 'Data science & ML', 'Python']);
  });

  it('compacts legacy focus-area prose when no controlled lane exists', () => {
    expect(opportunityTags(opportunity({
      focus_area: 'Translational cancer research and biomarkers',
    }))).toEqual(['Oncology']);
  });

  it('deduplicates and shortens long job-function labels', () => {
    expect(opportunityTags(opportunity({
      scientific_lanes: ['Bioprocess and manufacturing science'],
      job_functions: ['Process, manufacturing and quality', 'Technical product and program'],
    }))).toEqual(['Bioprocess', 'Manufacturing & quality', 'Technical programs']);
  });
});

describe('company context', () => {
  it('skips generic industry labels and uses the first specific descriptor', () => {
    expect(companyContextLine(opportunity())).toBe('protein design');
  });
});

describe('posting evidence and CTA labels', () => {
  it('distinguishes a LinkedIn listing from an official employer posting', () => {
    const linkedIn = opportunity({
      posting_url: 'https://www.linkedin.com/jobs/view/example-123',
      company_website: 'https://example.com/',
    });
    expect(postingLinkLabel(linkedIn)).toBe('View LinkedIn posting ↗');
    expect(sourceEvidenceLabel(linkedIn)).toBe('LinkedIn job posting');
  });

  it('recognizes employer-owned career domains', () => {
    const employer = opportunity({
      posting_url: 'https://careers.example.com/jobs/123',
      company_website: 'https://www.example.com/',
    });
    expect(postingLinkLabel(employer)).toBe('Official posting ↗');
    expect(sourceEvidenceLabel(employer)).toBe('Employer application page');
  });

  it('recognizes common employer ATS hosts', () => {
    const greenhouse = opportunity({
      posting_url: 'https://job-boards.greenhouse.io/example/jobs/123',
    });
    expect(postingLinkLabel(greenhouse)).toBe('Official posting ↗');
    expect(sourceEvidenceLabel(greenhouse)).toBe('Employer application page');
  });

  it('preserves named source evidence when available', () => {
    expect(sourceEvidenceLabel(opportunity({ source_name: 'Example careers board' })))
      .toBe('Official employer feed: Example');
  });
});

describe('small public-facing labels', () => {
  it('does not expose internal officer language for ordinary notes', () => {
    expect(noteLabel('Confirm timing before applying.')).toBe('Context');
    expect(noteLabel('Expected monthly compensation: $10,000.')).toBe('Compensation');
  });

  it('normalizes ambiguous deadline text without inventing a date', () => {
    expect(timingFallbackLabel(null)).toBe('No deadline stated');
    expect(timingFallbackLabel('Unknown')).toBe('No deadline stated');
    expect(timingFallbackLabel('Unknown; posting was active when checked'))
      .toBe('No deadline stated; posting was active when checked');
    expect(timingFallbackLabel('Rolling')).toBe('Rolling / no fixed deadline stated');
  });
});
