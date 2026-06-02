/**
 * Shared helpers for the Gift Registry storefront API. Mirrors the
 * wishlist + recently-viewed shared layers — duplicated rather than
 * generalised so each function can evolve its own auth strategy
 * (e.g. signed reservation links later).
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db, schema } from '@/db/client';

export interface ResolvedStore {
  storeId: string;
  shopDomain: string;
}

/** Resolves a `shop=` param to an active gift-registry store. Used for
 *  the CREATE flow — read/reserve flows don't need it because the
 *  share token already implies a store. */
export async function resolveActiveStore(req: NextRequest): Promise<ResolvedStore | null> {
  const shop = req.nextUrl.searchParams.get('shop')?.trim().toLowerCase();
  if (!shop) return null;
  const [store] = await db
    .select({ id: schema.stores.id, shopDomain: schema.stores.shopDomain })
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, shop));
  if (!store) return null;
  const [setting] = await db
    .select({ enabled: schema.storeFunctionSettings.enabled })
    .from(schema.storeFunctionSettings)
    .where(and(
      eq(schema.storeFunctionSettings.storeId, store.id),
      eq(schema.storeFunctionSettings.functionKey, 'gift-registry'),
    ));
  if (!setting?.enabled) return null;
  return { storeId: store.id, shopDomain: store.shopDomain };
}

export function corsHeaders(req: NextRequest): HeadersInit {
  const origin = req.headers.get('origin') ?? '';
  const allowed = !!origin && (
    origin.endsWith('.myshopify.com') ||
    origin.endsWith('.shopifypreview.com')
  );
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
  };
}

export function jsonResponse(
  req: NextRequest, body: unknown, status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

export function errorResponse(
  req: NextRequest, code: string, message: string, status = 400,
): NextResponse {
  return NextResponse.json({ error: code, message }, { status, headers: corsHeaders(req) });
}

export function handleOptions(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
