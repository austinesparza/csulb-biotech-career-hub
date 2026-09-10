import { describe, expect, it } from 'vitest';
import { validatePublicSubmission } from '../lib/submissions';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe('public submission validation', () => {
  it('normalizes a valid opportunity without inventing optional fields', () => {
    const result = validatePublicSubmission(form({
      type: 'opportunity', url: 'https://example.org/jobs/1', company: ' Example Bio ',
    }));
    expect(result).toEqual({
      ok: true,
      value: {
        submissionType: 'opportunity',
        payload: { url: 'https://example.org/jobs/1', company: 'Example Bio', title: null, details: null },
        submitterName: null,
        submitterEmail: null,
      },
    });
  });

  it.each([
    'http://example.org/jobs/1',
    'javascript:alert(1)',
    'https://user:password@example.org/jobs/1',
    'not a url',
  ])('rejects unsafe link %s', (url) => {
    expect(validatePublicSubmission(form({ type: 'opportunity', url })).ok).toBe(false);
  });

  it('rejects unsupported types and malformed optional email', () => {
    expect(validatePublicSubmission(form({ type: 'mentor_update', url: 'https://example.org' })).ok).toBe(false);
    expect(validatePublicSubmission(form({
      type: 'resource', url: 'https://example.org', email: 'not-an-email',
    }))).toEqual({ ok: false, error: 'Enter a valid email address or leave it blank.' });
  });

  it('enforces server-side length limits', () => {
    const result = validatePublicSubmission(form({
      type: 'correction', url: 'https://example.org', details: 'x'.repeat(1100),
    }));
    expect(result.ok && result.value.payload.details).toHaveLength(1000);
  });
});
