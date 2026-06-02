/**
 * POST /api/storefront/gift-registry/:token/items/:itemId/reserve
 *   body: { reserverName, reserverEmail, qty?, message? }
 *   → { reservationId }
 *
 * Public — anyone with the share link can reserve. The server enforces
 * `qty_reserved <= qty_wanted` to prevent overshooting.
 */

import type { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, handleOptions } from '../../../../_shared';
import { reserveItem } from '@/features/functions/gift-registry/storefront';
import type { GiftRegistryReservationInput } from '@/features/functions/gift-registry/types';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; itemId: string }> },
) {
  const { token, itemId } = await params;
  let body: GiftRegistryReservationInput;
  try {
    body = await req.json();
  } catch {
    return errorResponse(req, 'invalid_json', 'Body must be JSON');
  }
  try {
    const result = await reserveItem(token, itemId, body);
    return jsonResponse(req, result);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === 'registry not found' || msg === 'item not found' ? 404 : 400;
    return errorResponse(req, 'bad_input', msg, status);
  }
}

export const OPTIONS = handleOptions;
