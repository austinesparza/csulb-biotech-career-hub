'use client';

import { Analytics } from '@vercel/analytics/react';
import { redactAnalyticsEvent } from '@/lib/privacyAnalytics';

export function PrivacyAnalytics() {
  return (
    <Analytics
      mode="production"
      beforeSend={redactAnalyticsEvent}
    />
  );
}
