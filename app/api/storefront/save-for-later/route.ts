/**
 * GET  /api/storefront/save-for-later?shop=…&deviceId=…&email=…
 *   → { items: SaveForLaterItemRow[] }
 *
 * POST /api/storefront/save-for-later?shop=…
 *   body: { identity, snapshot }
 *   → { id, alreadyExisted }
 *
 * DELETE /api/storefront/save-for-later?shop=…&id=…&deviceId=…
 *   → { removed }
 */

import type { NextRequest } from 'next/server';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from './_shared';
import {
  saveItem, listSavedItems, removeSavedItem,
} from '@/features/functions/save-for-later/storefront';
import type {
  SaveForLaterIdentity, SaveForLaterSnapshot,
} from '@/features/functions/save-for-later/types';

export const dynamic = 'force-dynamic';

function identityFromSearch(req: NextRequest): SaveForLaterIdentity {
  const sp = req.nextUrl.searchParams;
  return {
    deviceId: sp.get('deviceId') ?? '',
    email: sp.get('email') ?? undefined,
    shopifyCustomerId: sp.get('shopifyCustomerId') ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Save for later is not active for this shop', 404);
  try {
    const items = await listSavedItems(store.storeId, identityFromSearch(req));
    return jsonResponse(req, store.shopDomain, { items });
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_identity', (err as Error).message);
  }
}

interface SaveBody {
  identity: SaveForLaterIdentity;
  snapshot: SaveForLaterSnapshot;
}

export async function POST(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Save for later is not active for this shop', 404);
  let body: SaveBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, store.shopDomain, 'invalid_json', 'Body must be JSON');
  }
  if (!body?.identity || !body?.snapshot) {
    return errorResponse(req, store.shopDomain, 'missing_payload', 'identity + snapshot required');
  }
  try {
    const result = await saveItem(store.storeId, body.identity, body.snapshot);
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_input', (err as Error).message);
  }
}

export async function DELETE(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Save for later is not active for this shop', 404);
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return errorResponse(req, store.shopDomain, 'missing_id', 'id query param required');
  try {
    const result = await removeSavedItem(store.storeId, identityFromSearch(req), id);
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_input', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
