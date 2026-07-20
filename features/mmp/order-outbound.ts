import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpBody } from '@/features/mmp/hmac';
import { buildMmpOrderPayload, type MmpOrderLine } from '@/features/mmp/order-push-logic';
import { hashOrderPayload, shouldPushOrder } from '@/features/mmp/order-push-state';
import { isBrandStatus } from '@/features/fulfillment/brand-statuses';
import { brandOwnedStore } from '@/features/mmp/brand-stores';

/** Dựng rawBody MMP cho 1 đơn (đọc fulfillment + brand lines + order). Không POST. */
async function buildOrderMmpBody(orderId: string): Promise<{ rawBody: string } | { error: string }> {
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return { error: 'no fulfillment' };
  const fLines = await db.select({
      id: schema.orderFulfillmentLines.id,
      sku: schema.orderFulfillmentLines.sku, qty: schema.orderFulfillmentLines.qty, status: schema.orderFulfillmentLines.status,
      title: schema.shopifyOrderLines.productTitle, vendor: schema.shopifyOrderLines.vendor,
      unitPrice: schema.shopifyOrderLines.unitPrice,
    })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  const [ord] = await db.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      shipName: schema.shopifyOrders.shipName, shipCountry: schema.shopifyOrders.shipCountry,
      processedAt: schema.shopifyOrders.processedAtShopify,
      financialStatus: schema.shopifyOrders.financialStatus,
      fulfillmentStatus: schema.shopifyOrders.fulfillmentStatus,
      cancelledAt: schema.shopifyOrders.cancelledAtShopify,
      store: schema.stores.name,
      currency: schema.shopifyOrders.currency,
      totalDiscount: schema.shopifyOrders.totalDiscount,
      totalShipping: schema.shopifyOrders.totalShipping,
      totalTax: schema.shopifyOrders.totalTax,
      totalPrice: schema.shopifyOrders.totalPrice,
    })
    .from(schema.shopifyOrders)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  if (!ord) return { error: 'no order' };
  // Ngày MEAN nhận hàng từ brand theo SKU — từ mmp_line_received (sync từ bảng Lark
  // "WH ngày MEAN nhận hàng", cột 'Visible - WH-Ngày MEAN nhận hàng gần nhất').
  // Khoá order_number BARE (bỏ '#').
  const bareOrder = (ord.orderNumber ?? '').replace(/^#/, '');
  const recvRows = bareOrder
    ? await db.select({ sku: schema.mmpLineReceived.sku, receivedAt: schema.mmpLineReceived.receivedAt })
        .from(schema.mmpLineReceived)
        .where(eq(schema.mmpLineReceived.orderNumber, bareOrder))
    : [];
  const recvBySku = new Map<string, Date>();
  for (const r of recvRows) {
    if (r.sku && r.receivedAt) recvBySku.set(r.sku, r.receivedAt instanceof Date ? r.receivedAt : new Date(r.receivedAt as unknown as string));
  }
  // Gửi MMP: line ĐANG CHỜ brand sản xuất (status brand) + line ĐÃ NHẬN từ brand
  // (SKU có ngày nhận). MMP cần cả hai để đối soát công nợ theo brand + ngày nhận.
  // NGOẠI LỆ store RIÊNG của brand (tinhatelier/mirermirer-official): MỌI line
  // đều thuộc brand — gửi toàn bộ, vendor fallback về vendor chuẩn của store.
  const owned = brandOwnedStore(ord.store);
  const brand = owned
    ? fLines
    : fLines.filter((l) => isBrandStatus(l.status) || (l.sku != null && recvBySku.has(l.sku)));
  if (brand.length === 0) return { error: 'no brand lines' };
  const brandLines: MmpOrderLine[] = brand.map((l) => {
    const ra = l.sku != null ? recvBySku.get(l.sku) : undefined;
    return {
      sku: l.sku, title: l.title ?? l.sku ?? '', qty: l.qty, vendor: l.vendor ?? owned?.vendor ?? null,
      receivedAt: ra ? ra.toISOString() : null,
      // Giá CHỈ gửi cho store riêng của brand (đối soát) — store đa-brand không giá.
      ...(owned && l.unitPrice != null ? { unitPrice: Number(l.unitPrice) } : {}),
    };
  });
  // Khối giá cấp đơn (order currency) — CHỈ store riêng của brand.
  const pricing = owned
    ? {
        currency: ord.currency,
        subtotal: brand.reduce((sum, l) => sum + (l.unitPrice != null ? Number(l.unitPrice) * l.qty : 0), 0),
        totalDiscount: ord.totalDiscount == null ? null : Number(ord.totalDiscount),
        totalShipping: ord.totalShipping == null ? null : Number(ord.totalShipping),
        totalTax: ord.totalTax == null ? null : Number(ord.totalTax),
        totalPrice: ord.totalPrice == null ? null : Number(ord.totalPrice),
      }
    : null;
  // receivedAt cấp ĐƠN = ngày nhận MỚI NHẤT trong các line. null nếu chưa nhận.
  const lineReceived = brandLines.map((l) => l.receivedAt).filter((d): d is string => !!d).sort();
  const orderReceivedAt = lineReceived.length ? lineReceived[lineReceived.length - 1] : null;
  const rawBody = JSON.stringify(buildMmpOrderPayload({
    orderNumber: ord.orderNumber, store: ord.store, recipientName: ord.shipName, shipCountry: ord.shipCountry,
    placedAt: ord.processedAt ? ord.processedAt.toISOString() : null,
    receivedAt: orderReceivedAt,
    financialStatus: ord.financialStatus ?? null,
    fulfillmentStatus: ord.fulfillmentStatus ?? null,
    cancelledAt: ord.cancelledAt ? ord.cancelledAt.toISOString() : null,
    brandLines,
    pricing,
  }));
  return { rawBody };
}

/** Đẩy đơn sang MMP CÓ TRACKING: bỏ qua nếu sent+hash trùng; ghi pending trước POST;
 *  cập nhật sent/failed. Dedup phía mình lo TRƯỜNG HỢP THƯỜNG (chạy lại/backfill/
 *  retry KHÔNG đẩy lại đơn đã sent-không-đổi). At-least-once: 2 check đồng thời cùng
 *  đơn (đọc state trước khi ghi pending) hoặc DB lỗi ngay SAU khi POST thành công
 *  (row kẹt 'pending' → lần sau POST lại) vẫn có thể gửi trùng → dedupe phía MMP là
 *  backstop cho các ca hiếm này. */
export async function pushOrderToMmp(orderId: string, opts?: { force?: boolean }): Promise<{ ok: boolean; skipped?: boolean; externalRef?: string; error?: string }> {
  const url = process.env.MMP_ORDERS_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return { ok: false, error: 'not configured' };

  const built = await buildOrderMmpBody(orderId);
  if ('error' in built) return { ok: false, error: built.error };
  const payloadHash = hashOrderPayload(built.rawBody);

  const [state] = await db.select({ status: schema.mmpOrderPushes.status, attempts: schema.mmpOrderPushes.attempts, payloadHash: schema.mmpOrderPushes.payloadHash })
    .from(schema.mmpOrderPushes).where(eq(schema.mmpOrderPushes.orderId, orderId)).limit(1);
  // force = gửi lại kể cả đơn đã 'sent' không đổi (vd đồng bộ lại toàn bộ để MMP
  // dựng đủ brand). MMP có dedupe backstop nên không tạo trùng.
  if (!opts?.force && !shouldPushOrder(state ?? null, payloadHash)) return { ok: true, skipped: true };

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
