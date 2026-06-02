/**
 * GET  /api/storefront/recently-viewed?shop=…&deviceId=…&email=…&limit=N
 *   → { items: RecentlyViewedItem[] }
 *
 * POST /api/storefront/recently-viewed?shop=…
 *   body: { identity, snapshot }
 *   → { id }
 */

import type { NextRequest } from 'next/server';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from './_shared';
import {
  listRecentForIdentity, recordView,
} from '@/features/functions/recently-viewed/storefront';
import type {
  RecentlyViewedIdentity, RecentlyViewedSnapshot,
} from '@/features/functions/recently-viewed/types';

export const dynamic = 'force-dynamic';

function identityFromSearch(req: NextRequest): RecentlyViewedIdentity {
  const sp = req.nextUrl.searchParams;
  return {
    deviceId: sp.get('deviceId') ?? '',
    email: sp.get('email') ?? undefined,
    shopifyCustomerId: sp.get('shopifyCustomerId') ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Recently Viewed is not active for this shop', 404);
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '12')));
  try {
    const items = await listRecentForIdentity(store.storeId, identityFromSearch(req), limit);
    return jsonResponse(req, store.shopDomain, { items });
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_identity', (err as Error).message);
  }
}

interface RecordViewBody {
  identity: RecentlyViewedIdentity;
  snapshot: RecentlyViewedSnapshot;
}

export async function POST(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, null, 'inactive_store', 'Recently Viewed is not active for this shop', 404);
  let body: RecordViewBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, store.shopDomain, 'invalid_json', 'Body must be JSON');
  }
  if (!body?.identity || !body?.snapshot) {
    return errorResponse(req, store.shopDomain, 'missing_payload', 'identity + snapshot required');
  }
  try {
    const result = await recordView(store.storeId, body.identity, body.snapshot);
    return jsonResponse(req, store.shopDomain, result);
  } catch (err) {
    return errorResponse(req, store.shopDomain, 'bad_input', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
