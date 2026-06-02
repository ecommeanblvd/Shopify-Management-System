/**
 * DELETE /api/storefront/gift-registry/:token/items/:itemId?ownerEmail=…
 *   → { removed }
 */

import type { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, handleOptions } from '../../../_shared';
import { removeItem } from '@/features/functions/gift-registry/storefront';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; itemId: string }> },
) {
  const { token, itemId } = await params;
  const ownerEmail = req.nextUrl.searchParams.get('ownerEmail') ?? '';
  if (!ownerEmail) {
    return errorResponse(req, 'missing_owner', 'ownerEmail required');
  }
  try {
    const result = await removeItem(token, ownerEmail, itemId);
    return jsonResponse(req, result);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === 'forbidden' ? 403 : msg === 'registry not found' ? 404 : 400;
    return errorResponse(req, 'bad_input', msg, status);
  }
}

export const OPTIONS = handleOptions;
