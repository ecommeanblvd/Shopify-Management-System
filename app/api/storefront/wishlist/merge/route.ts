/**
 * POST /api/storefront/wishlist/merge?shop=…
 *   body: { deviceId, email, shopifyCustomerId? }
 *   → { mergedItems: number }
 *
 * Called by the embed script the moment the shopper logs in: it takes
 * the guest (device-keyed) wishlist + the email-keyed one (or creates
 * the latter), folds the items in, deletes the guest record.
 */

import type { NextRequest } from 'next/server';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from '../_shared';
import { mergeGuestIntoEmail } from '@/features/functions/wishlist/storefront';

export const dynamic = 'force-dynamic';

interface MergeBody {
  deviceId: string;
  email: string;
  shopifyCustomerId?: string;
}

export async function POST(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Wishlist is not active for this shop', 404);
  let body: MergeBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, store.shopDomain, 'invalid_json', 'Body must be JSON');
  }
  if (!body.deviceId || !body.email) {
    return errorResponse(req, store.shopDomain, 'missing_fields', 'deviceId + email required');
  }
  try {
    const result = await mergeGuestIntoEmail(
      store.storeId, body.deviceId, body.email, body.shopifyCustomerId,
    );
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'merge_failed', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
