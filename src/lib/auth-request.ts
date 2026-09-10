import { NextRequest, NextResponse } from 'next/server';

export function isTrustedFormPost(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return false;

  return request.headers.get('sec-fetch-site') !== 'cross-site';
}

export function privateRedirect(target: URL) {
  const response = NextResponse.redirect(target, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
