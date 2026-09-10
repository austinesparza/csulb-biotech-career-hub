import type { BeforeSendEvent } from '@vercel/analytics/react';

const PRIVATE_PATH_PREFIXES = ['/admin', '/api', '/auth'];

export function isPrivatePath(pathname: string) {
  return PRIVATE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  let url: URL;

  try {
    url = new URL(event.url);
  } catch {
    return null;
  }

  if (isPrivatePath(url.pathname)) {
    return null;
  }

  url.search = '';
  url.hash = '';
  return { ...event, url: url.toString() };
}
