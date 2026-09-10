'use client';

import { Analytics } from '@vercel/analytics/react';
import { usePathname } from 'next/navigation';
import { isPrivatePath, redactAnalyticsEvent } from '@/lib/privacyAnalytics';

export function PrivacyAnalytics() {
  const pathname = usePathname();
  if (isPrivatePath(pathname)) return null;

  return (
    <Analytics
      mode="production"
      beforeSend={redactAnalyticsEvent}
    />
  );
}
