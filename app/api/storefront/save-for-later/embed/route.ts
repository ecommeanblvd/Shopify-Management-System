/**
 * GET /api/storefront/save-for-later/embed
 *   → text/javascript bundle for the cart-context save-for-later widget.
 *
 * Cached at the edge. Shop-agnostic — reads window.Shopify.shop at runtime.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildSaveForLaterScript } from '@/features/functions/save-for-later/embed/source';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

function originFor(req: NextRequest): string {
  try {
    const fromEnv = getEnv().SHOPIFY_APP_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, '');
  } catch {
    /* dev fallback */
  }
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  return host ? `${proto}://${host}` : '';
}

export function GET(req: NextRequest): NextResponse {
  const apiOrigin = originFor(req);
  const body = buildSaveForLaterScript({ apiOrigin }, {
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
