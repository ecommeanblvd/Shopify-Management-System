/**
 * HTTP endpoint cron đồng bộ catalog sản phẩm daily cho mọi store active.
 * Bảo vệ bằng bearer CRON_SECRET.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<railway-url>/api/cron/sync-products
 *
 * Response: { ok: true, ran, results: [{ shopDomain, products, error? }] }
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { syncStoreProducts } from '@/scripts/sync-shopify-products';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET is not configured on this deployment.' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const stores = await db.select({ shopDomain: schema.stores.shopDomain })
      .from(schema.stores).where(eq(schema.stores.status, 'active'));
    const results: Array<{ shopDomain: string; products: number; error?: string }> = [];
    for (const s of stores) {
      try {
        const { products } = await syncStoreProducts(s.shopDomain, Number.POSITIVE_INFINITY);
        results.push({ shopDomain: s.shopDomain, products });
      } catch (e) {
        results.push({ shopDomain: s.shopDomain, products: 0, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return NextResponse.json({ ok: true, ran: results.length, results });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
