/**
 * GET /api/storefront/gift-registry/:token
 *   → PublicRegistryView | 404
 */

import type { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, handleOptions } from '../_shared';
import { getPublicView } from '@/features/functions/gift-registry/storefront';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const view = await getPublicView(token);
  if (!view) return errorResponse(req, 'not_found', 'Registry not found', 404);
  return jsonResponse(req, view);
}

export const OPTIONS = handleOptions;
