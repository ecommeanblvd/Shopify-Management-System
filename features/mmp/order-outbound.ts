import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpBody } from '@/features/mmp/hmac';
import { buildMmpOrderPayload, type MmpOrderLine } from '@/features/mmp/order-push-logic';
import { hashOrderPayload, shouldPushOrder } from '@/features/mmp/order-push-state';
import { isBrandStatus } from '@/features/fulfillment/brand-statuses';

/** Dựng rawBody MMP cho 1 đơn (đọc fulfillment + brand lines + order). Không POST. */
async function buildOrderMmpBody(orderId: string): Promise<{ rawBody: string } | { error: string }> {
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return { error: 'no fulfillment' };
  const fLines = await db.select({
      sku: schema.orderFulfillmentLines.sku, qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status,
      title: schema.shopifyOrderLines.productTitle, vendor: schema.shopifyOrderLines.vendor,
    })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  const brand = fLines.filter((l) => isBrandStatus(l.status));
  if (brand.length === 0) return { error: 'no brand lines' };
  const [ord] = await db.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipName: schema.shopifyOrders.shipName, shipCountry: schema.shopifyOrders.shipCountry,
      store: schema.stores.name,
    })
    .from(schema.shopifyOrders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  if (!ord) return { error: 'no order' };
  const brandLines: MmpOrderLine[] = brand.map((l) => ({ sku: l.sku, title: l.title ?? l.sku ?? '', qty: l.qty, vendor: l.vendor ?? null }));
  const rawBody = JSON.stringify(buildMmpOrderPayload({
    orderNumber: ord.orderNumber, store: ord.store, recipientName: ord.shipName, shipCountry: ord.shipCountry, brandLines,
  }));
  return { rawBody };
}

/** Đẩy đơn sang MMP CÓ TRACKING: bỏ qua nếu sent+hash trùng; ghi pending trước POST;
 *  cập nhật sent/failed. Dedup phía mình lo TRƯỜNG HỢP THƯỜNG (chạy lại/backfill/
 *  retry KHÔNG đẩy lại đơn đã sent-không-đổi). At-least-once: 2 check đồng thời cùng
 *  đơn (đọc state trước khi ghi pending) hoặc DB lỗi ngay SAU khi POST thành công
 *  (row kẹt 'pending' → lần sau POST lại) vẫn có thể gửi trùng → dedupe phía MMP là
 *  backstop cho các ca hiếm này. */
export async function pushOrderToMmp(orderId: string): Promise<{ ok: boolean; skipped?: boolean; externalRef?: string; error?: string }> {
  const url = process.env.MMP_ORDERS_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return { ok: false, error: 'not configured' };

  const built = await buildOrderMmpBody(orderId);
  if ('error' in built) return { ok: false, error: built.error };
  const payloadHash = hashOrderPayload(built.rawBody);

  const [state] = await db.select({ status: schema.mmpOrderPushes.status, attempts: schema.mmpOrderPushes.attempts, payloadHash: schema.mmpOrderPushes.payloadHash })
    .from(schema.mmpOrderPushes).where(eq(schema.mmpOrderPushes.orderId, orderId)).limit(1);
  if (!shouldPushOrder(state ?? null, payloadHash)) return { ok: true, skipped: true };

  // Ghi pending TRƯỚC khi POST (để cron retry được kể cả khi POST ném).
  await db.insert(schema.mmpOrderPushes)
    .values({ orderId, status: 'pending', payloadHash })
    .onConflictDoUpdate({ target: schema.mmpOrderPushes.orderId, set: { status: 'pending', payloadHash, updatedAt: sql`now()` } });

  const signature = signMmpBody(secret, built.rawBody);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature },
      body: built.rawBody, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await db.update(schema.mmpOrderPushes).set({ status: 'failed', attempts: sql`${schema.mmpOrderPushes.attempts} + 1`, lastError: `http ${res.status}`, updatedAt: sql`now()` }).where(eq(schema.mmpOrderPushes.orderId, orderId));
      return { ok: false, error: `http ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    const externalRef = typeof data?.externalRef === 'string' ? data.externalRef : undefined;
    await db.update(schema.mmpOrderPushes).set({ status: 'sent', sentAt: sql`now()`, attempts: sql`${schema.mmpOrderPushes.attempts} + 1`, externalRef: externalRef ?? null, lastError: null, updatedAt: sql`now()` }).where(eq(schema.mmpOrderPushes.orderId, orderId));
    return { ok: true, externalRef };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    await db.update(schema.mmpOrderPushes).set({ status: 'failed', attempts: sql`${schema.mmpOrderPushes.attempts} + 1`, lastError: msg, updatedAt: sql`now()` }).where(eq(schema.mmpOrderPushes.orderId, orderId));
    return { ok: false, error: msg };
  }
}
