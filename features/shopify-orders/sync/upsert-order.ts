import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { mapShopifyOrder } from './shopify-mapper';
import { orderContentFingerprint, detectEdit } from './order-fingerprint';
import { soSanhDongHang } from './so-sanh-dong-hang';
import type { ShopifyOrderPayload } from '../shopify-types';
import { ensureFulfillmentForOrder } from '@/features/fulfillment/ensure-fulfillment';
import { ghiVoi } from '@/features/nhat-ky/ghi-voi';
import { MAY } from '@/features/nhat-ky/tac-nhan';

export type UpsertSource = 'webhook' | 'cron' | 'backfill';

/*
 * Nhãn "Đồng bộ Shopify" cho lượt ghi `shopify_orders` + `shopify_order_lines` bên dưới.
 *
 * Không ai BẤM gì ở đây cả: cả ba kênh (webhook, cron hằng giờ, backfill) ghi thay Shopify,
 * nên nhãn phải là nguồn MÁY. Thiếu nó, ngày trigger nhật ký bật cho hai bảng này (spec §8)
 * mọi dòng sinh ra sẽ hiện "Chưa gắn danh tính" — không phân biệt được với lỗi quên bọc.
 */
const TAC_NHAN_DONG_BO = { kieu: 'may', nhan: MAY.DONG_BO_SHOPIFY } as const;

/**
 * GraphQL trả customer.id dạng gid://shopify/Customer/N — normalize về N
 * để khớp customerIdExpr (raw_payload->'customer'->>'id') + index 0089.
 */
export function normalizeCustomerGid<T extends { customer?: { id?: string | null } | null }>(payload: T): T {
  const gid = payload.customer?.id;
  if (typeof gid === 'string') {
    const m = /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(gid);
    if (m) return { ...payload, customer: { ...payload.customer, id: m[1] } };
  }
  return payload;
}

/**
 * Idempotently upsert a Shopify order, its lines, and its refunds in a single
 * transaction. Safe to call from any of the three sync channels — last write
 * wins on the order row, lines are diffed against what is already stored
 * (see `so-sanh-dong-hang.ts`), and refunds dedup by shopify_refund_id.
 */
export async function upsertOrder(
  storeId: string,
  rawPayload: ShopifyOrderPayload,
  source: UpsertSource,
): Promise<string | null> {
  const payload = normalizeCustomerGid(rawPayload);
  const mapped = mapShopifyOrder(payload, storeId);

  // Cancel detection (spec §4e): the upsert below is last-write-wins, so the
  // previous cancelled state is gone after it runs. One cheap indexed select
  // (unique shopify_order_id) of the old timestamp before the upsert tells us
  // whether this payload flips the order null → cancelled.
  const [prev] = await db
    .select({
      id: schema.shopifyOrders.id,
      cancelledAtShopify: schema.shopifyOrders.cancelledAtShopify,
      contentFingerprint: schema.shopifyOrders.contentFingerprint,
      editedAt: schema.shopifyOrders.editedAt,
      editedAfterFulfilledAt: schema.shopifyOrders.editedAfterFulfilledAt,
    })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id))
    .limit(1);
  const becameCancelled =
    mapped.order.cancelledAtShopify !== null && prev !== undefined && prev.cancelledAtShopify === null;

  // Phát hiện sửa nội dung (sub-project C): hash địa chỉ+line; đơn đã "lên vận đơn"
  // (có shipment với tracking/label) mà nội dung đổi → cảnh báo.
  const nextFingerprint = orderContentFingerprint({
    shipName: mapped.order.shipName, shipAddress1: mapped.order.shipAddress1,
    shipAddress2: mapped.order.shipAddress2, shipCity: mapped.order.shipCity,
    shipPostcode: mapped.order.shipPostcode, shipCountry: mapped.order.shipCountry,
    lines: mapped.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
  });
  let isFulfilled = false;
  if (prev?.id) {
    const [ship] = await db.select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(and(
        eq(schema.shipments.orderId, prev.id),
        or(isNotNull(schema.shipments.trackingNumber), isNotNull(schema.shipments.labelCreatedAt)),
      ))
      .limit(1);
    isFulfilled = !!ship;
  }
  const editFlags = detectEdit({
    prevFingerprint: prev?.contentFingerprint ?? null,
    nextFingerprint, isFulfilled, now: new Date(),
    prevEditedAt: prev?.editedAt ?? null,
    prevEditedAfterFulfilledAt: prev?.editedAfterFulfilledAt ?? null,
  });

  let internalOrderId: string | undefined;

  /* `ghiVoi` thay cho `db.transaction` — ĐÚNG MỘT giao dịch như cũ, chỉ thêm một lệnh
   * `set_config` ở đầu. KHÔNG nới phạm vi: ba lệnh đọc Shopify/DB ở trên (`prev`, `ship`)
   * và hai việc best-effort ở dưới (`ensureFulfillmentForOrder`, `releaseOrderAllocations`)
   * cố ý ĐỨNG NGOÀI. Bài học `import-actions.ts` (chú thích `LO_GHI` ở
   * `features/shipments/import-actions.ts:40`): giao dịch dài là khoá dài trên bảng đang
   * chạy thật, và kéo lệnh gọi ngoài vào trong là đúng cái đã làm pooler rớt kết nối. */
  await ghiVoi(TAC_NHAN_DONG_BO, async (tx) => {
    const [row] = await tx
      .insert(schema.shopifyOrders)
      .values({
        ...mapped.order,
        rawPayload: payload,
        source,
        contentFingerprint: nextFingerprint,
        editedAt: editFlags.editedAt,
        editedAfterFulfilledAt: editFlags.editedAfterFulfilledAt,
      })
      .onConflictDoUpdate({
        target: schema.shopifyOrders.shopifyOrderId,
        set: {
          ...mapped.order,
          /* Email và tên khách là DỮ LIỆU CÓ ĐIỀU KIỆN: chỉ store cấp scope
           * `read_customers` mới trả về. Lượt đồng bộ nào không có chúng phải
           * GIỮ NGUYÊN giá trị cũ, không được ghi đè bằng null — mất email là
           * mất luôn, Shopify không cho đọc lại nếu scope bị rút. */
          ...(mapped.order.customerEmail == null ? { customerEmail: undefined } : {}),
          ...(mapped.order.customerName == null ? { customerName: undefined } : {}),
          rawPayload: payload,
          source,
          syncedAt: new Date(),
          contentFingerprint: nextFingerprint,
          editedAt: editFlags.editedAt,
          editedAfterFulfilledAt: editFlags.editedAfterFulfilledAt,
        },
      })
      .returning({ id: schema.shopifyOrders.id });

    internalOrderId = row!.id;

    /* Dòng hàng: SO rồi ghi đúng phần đổi, KHÔNG xoá sạch rồi chèn lại.
     *
     * Kiểu cũ (`DELETE` cả đơn + `INSERT` lại cả đơn) đúng về dữ liệu nhưng mỗi lượt cron
     * chạm lại một đơn không đổi gì vẫn là N lệnh xoá + N lệnh chèn. Khi trigger nhật ký
     * được bật cho `shopify_order_lines` (spec §8), mỗi lượt như thế đẻ N dòng `xoa` + N
     * dòng `them` nội dung y hệt nhau — đủ để chôn mất thay đổi thật của người.
     *
     * Đọc TRONG giao dịch (`tx`), không phải `db`: hàng đọc lên phải là hàng mà ba lệnh
     * ghi bên dưới sẽ đụng tới, và chỉ giao dịch này giữ được điều đó.
     *
     * Luật chèn/sửa/xoá nằm ở `soSanhDongHang` (thuần, có test): bộ test tích hợp của tệp
     * này cần `TEST_DATABASE_URL` nên nó đang SKIP, một test ở đó sẽ xanh giả. */
    const dangCo = await tx
      .select({
        id: schema.shopifyOrderLines.id,
        shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
        shopifyVariantId: schema.shopifyOrderLines.shopifyVariantId,
        shopifyProductId: schema.shopifyOrderLines.shopifyProductId,
        sku: schema.shopifyOrderLines.sku,
        vendor: schema.shopifyOrderLines.vendor,
        productTitle: schema.shopifyOrderLines.productTitle,
        variantTitle: schema.shopifyOrderLines.variantTitle,
        quantity: schema.shopifyOrderLines.quantity,
        unitPrice: schema.shopifyOrderLines.unitPrice,
        discountAlloc: schema.shopifyOrderLines.discountAlloc,
        total: schema.shopifyOrderLines.total,
        processingMinDays: schema.shopifyOrderLines.processingMinDays,
        processingMaxDays: schema.shopifyOrderLines.processingMaxDays,
        estimatedDelivery: schema.shopifyOrderLines.estimatedDelivery,
        eddMin: schema.shopifyOrderLines.eddMin,
        eddMax: schema.shopifyOrderLines.eddMax,
        soDo: schema.shopifyOrderLines.soDo,
      })
      .from(schema.shopifyOrderLines)
      .where(eq(schema.shopifyOrderLines.orderId, row!.id));

    const keHoach = soSanhDongHang(dangCo, mapped.lines);

    // XOÁ trước CHÈN: đơn bị Shopify đánh số lại dòng thì bản cũ phải đi trước bản mới,
    // kẻo giữa hai lệnh có lúc đơn mang gấp đôi số dòng hàng.
    if (keHoach.xoa.length > 0) {
      await tx.delete(schema.shopifyOrderLines).where(inArray(schema.shopifyOrderLines.id, keHoach.xoa));
    }
    for (const s of keHoach.sua) {
      await tx.update(schema.shopifyOrderLines).set(s.gia).where(eq(schema.shopifyOrderLines.id, s.id));
    }
    if (keHoach.chen.length > 0) {
      await tx.insert(schema.shopifyOrderLines).values(
        keHoach.chen.map((l) => ({ ...l, orderId: row!.id })),
      );
    }

    for (const refund of mapped.refunds) {
      await tx
        .insert(schema.shopifyOrderRefunds)
        .values({ ...refund, orderId: row!.id })
        // DoUpdate (thay DoNothing cũ): refund sync TRƯỚC khi có breakdown giờ
        // re-sync là được lấp chi tiết ship/lines; amount/reason cũng refresh.
        .onConflictDoUpdate({
          target: schema.shopifyOrderRefunds.shopifyRefundId,
          set: {
            amount: refund.amount, reason: refund.reason,
            ...(refund.shippingAmount != null ? { shippingAmount: refund.shippingAmount } : {}),
            ...(refund.lines != null ? { lines: refund.lines } : {}),
          },
        });
    }
  });

  if (internalOrderId) {
    // Best-effort: creating the fulfillment ops record must never break order
    // sync (the order itself is already committed above). Log and continue on
    // any failure — e.g. the fulfillment tables not yet migrated on this env,
    // or a transient error — so webhooks still return 2xx and orders keep flowing.
    try {
      await ensureFulfillmentForOrder(internalOrderId);
    } catch (err) {
      console.error(`ensureFulfillmentForOrder failed for order ${internalOrderId}:`, err);
    }

    // Order just became cancelled: release its reservations back to the
    // warehouse and hand them to the next waiting order. Best-effort — a
    // release failure must never break order sync (order already committed).
    if (becameCancelled) {
      try {
        const { releaseOrderAllocations } = await import('@/features/warehouse/release');
        await releaseOrderAllocations(internalOrderId);
      } catch (err) {
        console.error(`releaseOrderAllocations failed for order ${internalOrderId}:`, err);
      }
    }
  }
  return internalOrderId ?? null;
}
