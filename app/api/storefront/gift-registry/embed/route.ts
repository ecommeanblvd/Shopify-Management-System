/**
 * GET /api/storefront/gift-registry/embed
 *   → text/javascript bundle for the Gift Registry PDP button + modal.
 *
 * Cached at the edge. Shop-agnostic — the script reads
 * window.Shopify.shop at runtime.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildGiftRegistryScript } from '@/features/functions/gift-registry/embed/source';
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
  const body = buildGiftRegistryScript({ apiOrigin }, {
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
