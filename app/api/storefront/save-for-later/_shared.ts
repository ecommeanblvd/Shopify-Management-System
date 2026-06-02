/**
 * Shared helpers for the Save-for-later storefront API.
 */

import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db, schema } from '@/db/client';

export interface ResolvedStore {
  storeId: string;
  shopDomain: string;
}

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
      eq(schema.storeFunctionSettings.functionKey, 'save-for-later'),
    ));
  if (!setting?.enabled) return null;
  return { storeId: store.id, shopDomain: store.shopDomain };
}

export function corsHeaders(req: NextRequest, storeDomain: string | null): HeadersInit {
  const origin = req.headers.get('origin') ?? '';
  const allowed = !!origin && (
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

export function handleOptions(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req, null) });
}
