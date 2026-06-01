/**
 * GET  /api/storefront/wishlist?shop=…&email=…&deviceId=…
 *   → { wishlist: {…}, items: […] } | { wishlist: null, items: [] }
 *
 * POST /api/storefront/wishlist
 *   body: { identity, snapshot }
 *   → { wishlistId, itemId, alreadyExisted }
 *
 * DELETE /api/storefront/wishlist?shop=…&productId=…&variantId=…&…identity…
 *   → { removed: boolean }
 */

import type { NextRequest } from 'next/server';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from './_shared';
import {
  addItem, getWishlistWithItems, removeItem,
} from '@/features/functions/wishlist/storefront';
import type { WishlistIdentity, WishlistItemSnapshot } from '@/features/functions/wishlist/types';

export const dynamic = 'force-dynamic';

function identityFromSearch(req: NextRequest): WishlistIdentity {
  const sp = req.nextUrl.searchParams;
  return {
    email: sp.get('email') ?? undefined,
    deviceId: sp.get('deviceId') ?? undefined,
    shopifyCustomerId: sp.get('shopifyCustomerId') ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Wishlist is not active for this shop', 404);
  try {
    const result = await getWishlistWithItems(store.storeId, identityFromSearch(req));
    if (!result) return jsonResponse(req, store.shopDomain, { wishlist: null, items: [] });
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_identity', (err as Error).message);
  }
}

interface AddItemBody {
  identity: WishlistIdentity;
  snapshot: WishlistItemSnapshot;
}

export async function POST(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Wishlist is not active for this shop', 404);
  let body: AddItemBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, store.shopDomain, 'invalid_json', 'Body must be JSON');
  }
  if (!body?.snapshot?.shopifyProductId || !body.snapshot.productTitle || !body.snapshot.productHandle) {
    return errorResponse(req, store.shopDomain, 'missing_snapshot', 'snapshot.{shopifyProductId, productTitle, productHandle} required');
  }
  try {
    const result = await addItem(store.storeId, body.identity, body.snapshot);
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_identity', (err as Error).message);
  }
}

export async function DELETE(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Wishlist is not active for this shop', 404);
  const sp = req.nextUrl.searchParams;
  const productId = sp.get('productId');
  if (!productId) {
    return errorResponse(req, store.shopDomain, 'missing_product', 'productId query param required');
  }
  try {
    const result = await removeItem(
      store.storeId,
      identityFromSearch(req),
      productId,
      sp.get('variantId') ?? undefined,
    );
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_identity', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
