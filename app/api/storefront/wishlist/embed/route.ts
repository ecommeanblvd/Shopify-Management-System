/**
 * GET /api/storefront/wishlist/embed
 *   → text/javascript bundle for the storefront wishlist widget.
 *
 * Operators drop one script tag into their Shopify theme (or push it
 * via the Asset API): the script auto-discovers the shop from
 * `window.Shopify.shop`, mounts the heart button on PDPs, wires the
 * drawer + any `[data-wishlist-trigger]` element, and merges the
 * guest device wishlist into the customer's email wishlist on login.
 *
 * Cached at the edge for an hour. The bundle is shop-agnostic so a
 * single hit fans out to every storefront.
 *
 * NOTE: The activation flag is enforced by the data-mutating endpoints
 * (route.ts / merge/route.ts), so we serve the script unconditionally
 * here. A disabled-shop install becomes a no-op fetch loop instead of
 * a stack trace in the storefront console.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { buildEmbedScript } from '@/features/functions/wishlist/embed/source';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

function originFor(req: NextRequest): string {
  // Prefer the configured public app URL so the script always points at
  // the canonical origin (matches the per-store install snippet).
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
  // Minify in production for a smaller wire payload; ship raw in dev so
  // browser devtools maps directly to the source file.
  const body = buildEmbedScript({ apiOrigin }, {
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
