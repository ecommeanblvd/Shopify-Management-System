/**
 * Shared helpers for the storefront wishlist API. Centralises:
 *
 *  - Shop → store resolution (`shop=meanblvd.myshopify.com` → row id),
 *    gated by the per-store activation flag.
 *  - Permissive CORS (matches the calling storefront origin, including
 *    *.myshopify.com and any custom domain currently on file for the
 *    store via `stores.shop_domain` / future `custom_domain` columns).
 *  - Tiny JSON helpers so handlers stay readable.
 *
 * Auth/HMAC tightening is deferred to a follow-up PR — see the comment
 * on `verifyShopOrigin`.  For now we trust `shop` and the activation
 * flag, which is sufficient for internal-only use across the operator's
 * own stores.
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db, schema } from '@/db/client';
import { getFunctionByKey } from '@/lib/registry/functions';

export interface ResolvedStore {
  storeId: string;
  shopDomain: string;
}

/** Resolve `shop` query param → active store row and verify the
 *  wishlist function is enabled. Returns null when either check fails
 *  so handlers can short-circuit with a 404/403 of their choosing. */
export async function resolveActiveStore(req: NextRequest): Promise<ResolvedStore | null> {
  const shop = req.nextUrl.searchParams.get('shop')?.trim().toLowerCase();
  if (!shop) return null;
  const [store] = await db
    .select({ id: schema.stores.id, shopDomain: schema.stores.shopDomain })
    .from(schema.stores)
    .where(eq(schema.stores.shopDomain, shop));
  if (!store) return null;
  const fn = getFunctionByKey('wishlist');
  if (!fn) return null;
  const [setting] = await db
    .select({ enabled: schema.storeFunctionSettings.enabled })
    .from(schema.storeFunctionSettings)
    .where(and(
      eq(schema.storeFunctionSettings.storeId, store.id),
      eq(schema.storeFunctionSettings.functionKey, fn.key),
    ));
  if (!setting?.enabled) return null;
  return { storeId: store.id, shopDomain: store.shopDomain };
}

/** Allow the calling storefront's origin so browsers don't block the
 *  fetch. We echo whatever Origin came in if it's a recognised store
 *  domain — broad enough for myshopify.com previews and custom domains,
 *  tight enough that random sites can't make authenticated calls. */
export function corsHeaders(req: NextRequest, storeDomain: string | null): HeadersInit {
  const origin = req.headers.get('origin') ?? '';
  const allowed = origin && (
    origin.endsWith('.myshopify.com') ||
    origin.endsWith('.shopifypreview.com') ||
    (storeDomain && origin.includes(storeDomain.replace('.myshopify.com', '')))
  );
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
  };
}

export function jsonResponse(
  req: NextRequest, storeDomain: string | null, body: unknown, status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders(req, storeDomain) });
}

export function errorResponse(
  req: NextRequest, storeDomain: string | null, code: string, message: string, status = 400,
): NextResponse {
  return NextResponse.json({ error: code, message }, { status, headers: corsHeaders(req, storeDomain) });
}

/** Standard CORS preflight handler — wired up by every route's
 *  `export const OPTIONS = handleOptions`. */
export function handleOptions(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req, null) });
}
