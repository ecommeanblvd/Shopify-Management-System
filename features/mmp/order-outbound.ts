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
      discountAlloc: schema.shopifyOrderLines.discountAlloc,
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
      shippingDiscount: schema.shopifyOrders.shippingDiscount,
      totalTax: schema.shopifyOrders.totalTax,
      totalPrice: schema.shopifyOrders.totalPrice,
      transactionFee: schema.shopifyOrders.transactionFee,
      transactionFeeNative: schema.shopifyOrders.transactionFeeNative,
      transactionFeeNativeCurrency: schema.shopifyOrders.transactionFeeNativeCurrency,
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
      // vendor: custom line item (Shipping Fee, đồ custom) có vendor = '' (chuỗi
      // RỖNG, không phải null) → coi như thiếu để fallback vendor chuẩn của store
      // riêng còn ăn. Vendor rỗng từng làm MMP không gắn được đơn vào brand
      // (TA2013/TA2044/TA2098/TA2258 "mất tích" phía MMP, 29/07).
      sku: l.sku, title: l.title ?? l.sku ?? '', qty: l.qty,
      vendor: (l.vendor?.trim() || owned?.vendor) ?? null,
      receivedAt: ra ? ra.toISOString() : null,
      // Giá THEO LINE cho MỌI store (CEO 30/07, phương án 1): store đa-brand cũng
      // gửi unitPrice + lineDiscount để MMP đối soát doanh số brand — MMP phải lọc
      // line theo vendor, brand chỉ thấy giá line của chính mình. Tổng cấp đơn
      // (pricing) vẫn CHỈ store riêng.
      ...(l.unitPrice != null ? { unitPrice: Number(l.unitPrice) } : {}),
      ...(l.discountAlloc != null ? { lineDiscount: Number(l.discountAlloc) } : {}),
    };
  });
  // Cước hàng hoàn đã gắn về đơn (VND) — chỉ tra khi store riêng (tránh query thừa).
  let returnShippingVnd = 0;
  // Tổng tiền ĐÃ HOÀN khách (order currency) — refund một phần cũng có số.
  let refundedAmount = 0;
  if (owned) {
    const ret = await db.execute(sql`
      SELECT COALESCE(SUM(total::float8), 0) AS v FROM carrier_bill_lines WHERE return_of_order_id = ${orderId}`);
    returnShippingVnd = Math.round(Number((ret.rows[0] as { v?: unknown })?.v ?? 0));
    const refunds = await db.execute(sql`
      SELECT COALESCE(SUM(amount::float8), 0) AS v FROM shopify_order_refunds WHERE order_id = ${orderId}`);
    refundedAmount = Number((refunds.rows[0] as { v?: unknown })?.v ?? 0);
  }
  // CHI PHÍ SHIP thực (CEO 03/08 — store có config shipCost, hiện chỉ TA):
  // cước carrier THẬT từ bill (Σ shipment_charges, VND) + phí xử lý INS $/đơn.
  // Không có bill → không gửi (không suy đoán).
  let shippingCost: { carrierVnd: number; insHandlingVnd: number; totalVnd: number; source: 'carrier_bill' | 'ops_sheet' } | undefined;
  if (owned?.shipCost) {
    // 2 nguồn cước thực (cùng gốc bill carrier, dedupe theo tracking):
    // 1. shipment_charges nối qua shipments (đơn từ ~06/2025 có shipment);
    // 2. carrier_bill_lines khớp MÃ ĐƠN (#TAxxxx) — đơn cũ 01-05/2025 không có
    //    shipment để nối nhưng bill VẪN ghi ref (MMP báo thiếu 03/08). Loại dòng
    //    hàng hoàn (return_of_order_id — đã gửi riêng ở returnShippingVnd).
    const sc = await db.execute(sql`
      SELECT COALESCE((
        SELECT SUM(sc.total_amount::float8)
        FROM shipments shp JOIN shipment_charges sc ON sc.shipment_id = shp.id
        WHERE shp.order_id = ${orderId}), 0)
      + COALESCE((
        SELECT SUM(l.total::float8)
        FROM carrier_bill_lines l
        WHERE l.order_number IS NOT NULL
          AND replace(l.order_number, '#', '') = replace(${ord.orderNumber}, '#', '')
          AND l.return_of_order_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM shipments shp2
            JOIN shipment_charges sc2 ON sc2.shipment_id = shp2.id
            WHERE shp2.order_id = ${orderId} AND shp2.tracking_number = l.tracking_number)), 0) AS v`);
    const billedVnd = Math.round(Number((sc.rows[0] as { v?: unknown })?.v ?? 0));
    // Fallback đơn CỔ (2024-05/2025, bill không có trong SMS): ops tra tay từ
    // bill cũ → shipping_cost_override (sheet Lark 04/08). Bill trong SMS thắng.
    const overrideVnd = billedVnd > 0 ? 0 : Math.round(Number(
      ((await db.execute(sql`SELECT shipping_cost_override AS v FROM shopify_orders WHERE id = ${orderId}`)).rows[0] as { v?: unknown })?.v ?? 0));
    const carrierVnd = billedVnd > 0 ? billedVnd : overrideVnd;
    if (carrierVnd > 0) {
      // Toàn bộ bằng VND (CEO 03/08): $5 INS quy VND rồi cộng thẳng vào cước.
      const insHandlingVnd = Math.round(owned.shipCost.insHandlingUsd * owned.shipCost.fxVndPerUsd);
      shippingCost = { carrierVnd, insHandlingVnd, totalVnd: carrierVnd + insHandlingVnd, source: billedVnd > 0 ? 'carrier_bill' : 'ops_sheet' };
    }
  }
  // Chi tiết từng lần hoàn (hoàn ship? hoàn đồ nào?) — chỉ store riêng.
  let refundDetails: Array<{ refundedAt: string; amount: number; shippingAmount?: number; lines?: Array<{ sku: string | null; title: string | null; qty: number; amount: number }> }> = [];
  if (owned) {
    const rows = await db.select({
      refundedAt: schema.shopifyOrderRefunds.refundedAt,
      amount: schema.shopifyOrderRefunds.amount,
      shippingAmount: schema.shopifyOrderRefunds.shippingAmount,
      lines: schema.shopifyOrderRefunds.lines,
    }).from(schema.shopifyOrderRefunds).where(eq(schema.shopifyOrderRefunds.orderId, orderId));
    refundDetails = rows.map((r) => ({
      refundedAt: r.refundedAt.toISOString(),
      amount: Number(r.amount),
      ...(r.shippingAmount != null ? { shippingAmount: Number(r.shippingAmount) } : {}),
      ...(Array.isArray(r.lines)
        ? { lines: (r.lines as Array<{ sku: string | null; title: string | null; qty: number; amount: string }>).map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, amount: Number(l.amount) })) }
        : {}),
    }));
  }
  // Khối giá cấp đơn (order currency) — CHỈ store riêng của brand.
  const pricing = owned
    ? {
        currency: ord.currency,
        subtotal: brand.reduce((sum, l) => sum + (l.unitPrice != null ? Number(l.unitPrice) * l.qty : 0), 0),
        totalDiscount: ord.totalDiscount == null ? null : Number(ord.totalDiscount),
        totalShipping: ord.totalShipping == null ? null : Number(ord.totalShipping),
        // Promo 50% off shipping của brand: MMP đối soát phí ship cần cả số GIẢM.
        // Phí ship gốc = totalShipping + totalShippingDiscount. Validator MMP
        // (31/07) không nhận null → KHÔNG có dữ liệu thì BỎ KEY.
        ...(ord.shippingDiscount != null ? { totalShippingDiscount: Number(ord.shippingDiscount) } : {}),
        totalTax: ord.totalTax == null ? null : Number(ord.totalTax),
        totalPrice: ord.totalPrice == null ? null : Number(ord.totalPrice),
        // Refund (kể cả MỘT PHẦN): doanh thu thực = totalPrice − refundedAmount.
        refundedAmount,
        // Chi tiết từng lần hoàn (hoàn ship/hoàn đồ SKU nào) — vắng khi không có refund.
        ...(refundDetails.length > 0 ? { refunds: refundDetails } : {}),
        // Chi phí ship thực (cước bill + phí INS) — vắng khi đơn chưa có bill.
        ...(shippingCost ? { shippingCost } : {}),
        ...(returnShippingVnd > 0 ? { returnShippingVnd } : {}),
        // Phí transaction cổng thanh toán (CEO 24/07 — store riêng cần cho đối
        // soát net): fee quy đồng đơn + fee gốc theo đồng payout. Validator MMP
        // (31/07) không nhận null → đơn CHƯA có dữ liệu fees thì BỎ KEY.
        ...(ord.transactionFee != null ? { transactionFee: Number(ord.transactionFee) } : {}),
        ...(ord.transactionFeeNative != null ? { transactionFeeNative: Number(ord.transactionFeeNative) } : {}),
        ...(ord.transactionFeeNativeCurrency != null ? { transactionFeeNativeCurrency: ord.transactionFeeNativeCurrency } : {}),
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
    currency: ord.currency ?? null, // store đa-brand: đi kèm khi line có unitPrice (validator MMP)
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
