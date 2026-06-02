/**
 * POST /api/storefront/gift-registry?shop=…
 *   body: CreateRegistryInput
 *   → { id, shareToken, url }
 *
 * Creates a new registry. The owner gets the share token back; they're
 * expected to bookmark it. A future PR adds "/gr/find?email=…" to
 * recover lost tokens — for now the token is the only handle.
 */

import type { NextRequest } from 'next/server';
import {
  resolveActiveStore, jsonResponse, errorResponse, handleOptions,
} from './_shared';
import { createRegistry } from '@/features/functions/gift-registry/storefront';
import type { CreateRegistryInput } from '@/features/functions/gift-registry/types';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const store = await resolveActiveStore(req);
  if (!store) return errorResponse(req, 'inactive_store', 'Gift Registry is not active for this shop', 404);
  let body: CreateRegistryInput;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 'invalid_json', 'Body must be JSON');
  }
  try {
    const reg = await createRegistry(store.storeId, body);
    const base = getEnv().SHOPIFY_APP_URL.replace(/\/$/, '');
    return jsonResponse(req, {
      id: reg.id,
      shareToken: reg.shareToken,
      url: `${base}/gr/${reg.shareToken}`,
    });
  } catch (err) {
    return errorResponse(req, 'bad_input', (err as Error).message);
  }
}

export const OPTIONS = handleOptions;
