/**
 * GET /api/storefront/recently-viewed/embed
 *   → text/javascript bundle for the Recently Viewed carousel.
 *
 * Cached at the edge for an hour. Shop-agnostic: the script reads
 * window.Shopify.shop at runtime and passes it to every API call.
 *
 * Mirrors the wishlist embed route — kept duplicated so each function
 * can evolve its own caching / production-vs-dev policy independently.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildRecentlyViewedScript } from '@/features/functions/recently-viewed/embed/source';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

function originFor(req: NextRequest): string {
  try {
    const fromEnv = getEnv().SHOPIFY_APP_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
  } catch {
    /* fall through to header sniff for non-prod test contexts */
  }
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return host ? `${proto}://${host}` : '';
}

export function GET(req: NextRequest): NextResponse {
  const apiOrigin = originFor(req);
  const body = buildRecentlyViewedScript({ apiOrigin }, {
    minify: process.env.NODE_ENV === 'production',
  });
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'access-control-allow-origin': '*',
    },
  });
}
