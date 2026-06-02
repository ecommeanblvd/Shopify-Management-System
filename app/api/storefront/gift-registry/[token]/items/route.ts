/**
 * POST /api/storefront/gift-registry/:token/items
 *   body: { ownerEmail, snapshot }
 *   → { itemId }
 *
 * Owner-only: appends an item. Until we have signed JWTs, ownership is
 * proven by matching the owner_email column.
 */

import type { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, handleOptions } from '../../_shared';
import { addItem } from '@/features/functions/gift-registry/storefront';
import type { GiftRegistryItemSnapshot } from '@/features/functions/gift-registry/types';

export const dynamic = 'force-dynamic';

interface AddItemBody {
  ownerEmail: string;
  snapshot: GiftRegistryItemSnapshot;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let body: AddItemBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 'invalid_json', 'Body must be JSON');
  }
  if (!body?.ownerEmail || !body?.snapshot) {
    return errorResponse(req, 'missing_payload', 'ownerEmail + snapshot required');
  }
  try {
    const result = await addItem(token, body.ownerEmail, body.snapshot);
    return jsonResponse(req, result);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === 'forbidden' ? 403 : msg === 'registry not found' ? 404 : 400;
    return errorResponse(req, 'bad_input', msg, status);
  }
}

export const OPTIONS = handleOptions;
