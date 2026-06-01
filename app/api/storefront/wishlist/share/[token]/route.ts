/**
 * GET /api/storefront/wishlist/share/:token
 *   → public read of a shared wishlist. Does NOT require the `shop`
 *     param; the token implies the store. Email is never returned.
 *
 * Used by both /wl/[token] (server-side render) and by any storefront
 * widget that wants to embed a remote wishlist.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getWishlistByShareToken } from '@/features/functions/wishlist/storefront';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const view = await getWishlistByShareToken(token);
  if (!view) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(view, {
    headers: { 'access-control-allow-origin': '*' },
  });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
    },
  });
}
