import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VerificationEvidence, type VerificationTaskEvidence } from '../app/admin/review/task-list';

vi.mock('../app/admin/review/actions', () => ({ resolveReviewTask: async () => {} }));

const evidence: VerificationTaskEvidence = {
  id: 'test-id', observed_url: 'https://careers.example.org/jobs/123', final_url: 'https://careers.example.org/jobs/123',
  retrieved_at: '2026-09-28T01:00:00Z', page_state: 'apply_visible', outcome: 'review_candidate',
  requisition_id: '123', content_sha256: 'a'.repeat(64), snapshot_storage_path: 'verification/test/a.txt',
  gates: { degreeLevel: { value: 'graduate_accepted', quote: 'Master’s students may apply' },
    institutionRestriction: { value: 'unknown', quote: null } },
  comparison: { employer: { status: 'tenant_confirmed' } },
  duplicates: { matches: [], related: [{ table: 'source_postings', id: 'other-req', basis: 'related_title_different_requisition' }] },
};

describe('private verification task evidence', () => {
  it('shows the quote, unknown gates, related requisitions and UTC observation to the officer', () => {
    const html = renderToStaticMarkup(createElement(VerificationEvidence, { record: evidence }));
    expect(html).toContain('Master’s students may apply');
    expect(html).toContain('Institution');
    expect(html).toContain('unknown');
    expect(html).toContain('1 related requisitions kept separate');
    expect(html).toContain('UTC');
    expect(html).toContain('/admin/add');
  });

  it('escapes untrusted quotes and never links to a non-HTTPS final URL', () => {
    const html = renderToStaticMarkup(createElement(VerificationEvidence, { record: { ...evidence,
      observed_url: 'javascript:alert(1)', final_url: 'javascript:alert(2)',
      gates: { degreeLevel: { value: 'unknown', quote: '<script>alert(3)</script>' } },
    } }));
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
