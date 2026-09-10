import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { redactAnalyticsEvent } from '../lib/privacyAnalytics';

const analytics = readFileSync('src/components/privacy-analytics.tsx', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');
const privacy = readFileSync('src/app/privacy/page.tsx', 'utf8');

describe('privacy-preserving analytics', () => {
  it('runs only in production and excludes private application surfaces', () => {
    expect(analytics).toContain('mode="production"');
    for (const path of ['/admin', '/admin/sources', '/api/cron/ingest', '/auth/update-password']) {
      expect(
        redactAnalyticsEvent({ type: 'pageview', url: `https://example.test${path}?code=secret` }),
      ).toBeNull();
    }
  });

  it('removes query parameters and fragments before sending public events', () => {
    expect(
      redactAnalyticsEvent({
        type: 'pageview',
        url: 'https://example.test/opportunities?utm_source=club#listing',
      }),
    ).toEqual({ type: 'pageview', url: 'https://example.test/opportunities' });
  });

  it('fails closed for malformed event URLs without hiding similarly named public routes', () => {
    expect(redactAnalyticsEvent({ type: 'pageview', url: 'not a URL' })).toBeNull();
    expect(
      redactAnalyticsEvent({ type: 'pageview', url: 'https://example.test/administering' }),
    ).toEqual({ type: 'pageview', url: 'https://example.test/administering' });
  });

  it('is mounted once and disclosed in the privacy notice', () => {
    expect(layout.match(/<PrivacyAnalytics \/>/g)).toHaveLength(1);
    expect(privacy).toContain('Vercel Web Analytics');
    expect(privacy).toContain('query parameters are removed');
  });
});
