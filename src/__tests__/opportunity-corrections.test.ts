import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPublishedCorrection, validateRevisionReason } from '../lib/opportunity-corrections';
import { parseDeadline } from '../lib/normalize';

const migration = readFileSync('supabase/migrations/0016_audited_opportunity_corrections.sql', 'utf8');
const actions = readFileSync('src/app/admin/manage/actions.ts', 'utf8');
const page = readFileSync('src/app/admin/manage/page.tsx', 'utf8');

const validDraft = {
  title: 'Graduate Research Intern',
  postingUrl: 'HTTPS://Example.com/jobs/1/?utm_source=test',
  location: 'Long Beach, CA',
  eligibility: "Currently enrolled master's students",
  focusArea: 'Genomics',
  deadline: '2027-03-15',
  deadlineText: 'March 15, 2027',
  startDateText: 'Summer 2027',
  paidStatus: 'paid' as const,
  applicationType: 'Direct',
  status: 'open_verified' as const,
  publicNotes: 'Apply early.',
  audienceBucket: 'graduate' as const,
  audienceReason: "Posting explicitly accepts master's students.",
  graduateStage: 'msc_any' as const,
  eligibilityEvidence: "Master's degree program named in requirements.",
  workAuthorization: 'See official posting.',
};

describe('published opportunity corrections', () => {
  it('normalizes a correction and recomputes identity keys', () => {
    const result = buildPublishedCorrection(validDraft, 'Example Biotech');
    expect(result.posting_url).toBe('https://example.com/jobs/1');
    expect(result.deadline).toBe('2027-03-15');
    expect(result.dedupe_key).toContain('example biotech');
    expect(result.family_key).toContain('graduate research intern');
  });

  it('parses ISO deadlines without treating the suffix as month/day/year', () => {
    expect(parseDeadline('2027-03-15')).toBe('2027-03-15');
  });

  it('rejects corrections that would cross the public audience boundary', () => {
    expect(() => buildPublishedCorrection({ ...validDraft, audienceBucket: 'ineligible' }, 'Example Biotech'))
      .toThrow('Choose the student audience and stage supported by the posting');
  });

  it('accepts an undergraduate-only record when its stage matches', () => {
    const result = buildPublishedCorrection({
      ...validDraft,
      audienceBucket: 'undergraduate',
      graduateStage: 'not_msc',
    }, 'Example Biotech');
    expect(result.audience_bucket).toBe('undergraduate');
    expect(result.graduate_stage).toBe('not_msc');
  });

  it('requires an explanatory audit reason', () => {
    expect(() => validateRevisionReason('typo')).toThrow('at least 8 characters');
    expect(validateRevisionReason('Corrected the deadline from the source.')).toContain('Corrected');
  });

  it('keeps history append-only and mutations service-only', () => {
    expect(migration).toContain('create table if not exists public.opportunity_revisions');
    expect(migration).toContain("action in ('correction', 'unpublish', 'restore')");
    expect(migration).toContain('before_snapshot');
    expect(migration).toContain('after_snapshot');
    expect(migration).toContain('for update');
    expect(migration).toContain('this record changed after the page loaded');
    expect(migration).toContain('revoke execute on function public.revise_published_opportunity');
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toMatch(/delete\s+from\s+public\.opportunity_revisions/i);
  });

  it('requires officer verification before the service client and exposes audited controls', () => {
    expect(actions.indexOf('await requireOfficer()')).toBeLessThan(actions.indexOf('createServiceClient()'));
    expect(actions).toContain('p_expected_updated_at');
    expect(actions).toContain('p_source_confirmed: true');
    expect(actions).toContain("p_action: 'unpublish'");
    expect(actions).toContain("p_action: 'restore'");
    expect(page).toContain('Every action requires a reason');
    expect(page).not.toContain('private_notes');
  });
});
