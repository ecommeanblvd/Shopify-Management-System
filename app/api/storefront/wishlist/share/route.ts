/**
 * POST /api/storefront/wishlist/share
 *   body: { identity: WishlistIdentity }
 *   → { token, url }
 *
 * Idempotent: re-calling with the same identity returns the same token.
 */

import type { NextRequest } from 'next/server';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from '../_shared';
import { getOrCreateShareToken } from '@/features/functions/wishlist/storefront';
import type { WishlistIdentity } from '@/features/functions/wishlist/types';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface ShareBody { identity: WishlistIdentity }

export async function POST(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Wishlist is not active for this shop', 404);
  let body: ShareBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, store.shopDomain, 'invalid_json', 'Body must be JSON');
  }
  if (!body?.identity) {
    return errorResponse(req, store.shopDomain, 'missing_identity', 'identity required');
  }
  try {
    const { token } = await getOrCreateShareToken(store.storeId, body.identity);
    const base = getEnv().SHOPIFY_APP_URL.replace(/\/$/, '');
    return jsonResponse(req, store.shopDomain, {
      token,
      url: `${base}/wl/${token}`,
    });
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_identity', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
