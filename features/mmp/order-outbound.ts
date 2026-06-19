import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpBody } from '@/features/mmp/hmac';
import { buildMmpOrderPayload, type MmpOrderLine } from '@/features/mmp/order-push-logic';
import type { SendResult } from '@/features/mmp/outbound';

// Dòng brand (MMP phải sản xuất) — khớp BRAND_STATUSES ở staging-logic.
const BRAND_STATUSES = ['out_of_stock', 'brand_requested', 'brand_confirmed', 'brand_rejected'];

/** Đẩy bản ghi đơn (tối giản PII) sang MMP /api/integration/orders khi đơn có dòng
 *  brand. Gate: chưa cấu hình → 'not configured'; không có dòng brand → 'no brand lines'. */
export async function sendOrderToMmp(orderId: string): Promise<SendResult> {
  const url = process.env.MMP_ORDERS_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET; // cùng giá trị MEAN_WEBHOOK_SECRET
  if (!url || !secret) return { ok: false, error: 'not configured' };

  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return { ok: false, error: 'no fulfillment' };

  const fLines = await db.select({ sku: schema.orderFulfillmentLines.sku, qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  const brand = fLines.filter((l) => BRAND_STATUSES.includes(l.status as string));
  if (brand.length === 0) return { ok: false, error: 'no brand lines' };

  const [ord] = await db.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipName: schema.shopifyOrders.shipName, shipCountry: schema.shopifyOrders.shipCountry,
      store: schema.stores.name,
    })
    .from(schema.shopifyOrders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  if (!ord) return { ok: false, error: 'no order' };

  // title theo sku (map từ shopify_order_lines của đơn).
  const oLines = await db.select({ sku: schema.shopifyOrderLines.sku, title: schema.shopifyOrderLines.productTitle })
    .from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, orderId));
  const titleBySku = new Map<string, string>();
  for (const l of oLines) if (l.sku) titleBySku.set(l.sku, l.title);
  const brandLines: MmpOrderLine[] = brand.map((l) => ({ sku: l.sku, title: (l.sku && titleBySku.get(l.sku)) || l.sku || '', qty: l.qty }));

  const rawBody = JSON.stringify(buildMmpOrderPayload({
    orderNumber: ord.orderNumber, store: ord.store, recipientName: ord.shipName, shipCountry: ord.shipCountry, brandLines,
  }));
  const signature = signMmpBody(secret, rawBody);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature },
      body: rawBody, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `http ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, externalRef: typeof data?.externalRef === 'string' ? data.externalRef : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' };
  }
}
