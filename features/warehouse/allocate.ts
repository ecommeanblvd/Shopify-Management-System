/** Auto-allocation hai chiều (spec §4a/§4b):
 *  docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md
 *  Best-effort: lỗi không được phá sync đơn — caller bọc try/catch. */
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { pickItem, fifoOrder } from './allocation-logic';
import { applyMovement } from './ledger';
import { recomputeRollup } from '@/features/fulfillment/rollup';

const ACTOR = 'system:allocator';

export function toCandidates(
  rows: Array<{ warehouseCode: string; qtyOnHand: number; qtyReserved: number }>,
): Array<{ code: string; available: number }> {
  return rows.map((r) => ({ code: r.warehouseCode, available: r.qtyOnHand - r.qtyReserved }));
}

/** Đơn mới về: cấp kho cho từng dòng pending_check có SKU.
 *  Dòng không SKU bỏ qua (spec §6 — operator xử lý tay). */
export async function allocateOrder(orderId: string): Promise<void> {
  // Một select duy nhất (index orderId unique + fulfillmentId) — chạy trên
  // MỌI lần sync đơn nên đường "không có gì để cấp" phải rẻ, không ghi gì.
  const lines = await db.select({ id: schema.orderFulfillmentLines.id, sku: schema.orderFulfillmentLines.sku, cancelledAtShopify: schema.shopifyOrders.cancelledAtShopify })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders,
      eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(eq(schema.orderFulfillment.orderId, orderId),
               eq(schema.orderFulfillmentLines.status, 'pending_check')));
  // Đơn đã huỷ: không cấp hàng (release hook lo phần đã giữ).
  if (lines.length > 0 && lines[0].cancelledAtShopify != null) return;
  for (const line of lines) {
    if (!line.sku) continue;
    try {
      await allocateLine(line.id);
    } catch (err) {
      // Một dòng lỗi không được chặn các dòng còn lại của đơn.
      console.error(`allocateOrder: allocateLine failed for line ${line.id}`, err);
    }
  }
}

/** Cấp MỘT dòng trong transaction riêng. Trả về true nếu cấp được.
 *  Thứ tự lock: MÓN TỒN (phía inventory) trước, DÒNG ĐƠN sau — khớp
 *  checkStockForOrder (features/fulfillment/actions.ts) để hai luồng không
 *  deadlock nhau.
 *
 *  Per-unit (spec §3): cấp ĐÚNG MỘT MÓN `in_stock` cụ thể (FIFO theo
 *  qcCheckedAt, kho nhiều món nhất → tie GVM/AP/DM). v1 mỗi dòng cấp 1 món /
 *  qty=1 — khớp dữ liệu thật (mỗi món qty 1). Dòng qty>1 chỉ cấp 1 món, phần
 *  còn lại vẫn để pass sau / out_of_stock; KHÔNG dựng multi-món lần này. */
export async function allocateLine(lineId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // 1) Đọc dòng đơn KHÔNG lock — chỉ để biết SKU cần lock món tồn.
    const [peek] = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, lineId));
    if (!peek || !peek.sku) return false;
    if (peek.status !== 'pending_check' && peek.status !== 'out_of_stock') return false;

    // 2) Lock các MÓN in_stock của SKU (ORDER BY id để thứ tự lock nhiều món
    //    luôn xác định — hai allocator lock cùng chiều, không vòng chờ).
    const items = await tx.select({
      id: schema.goodsReceiptItems.id,
      warehouseCode: schema.goodsReceiptItems.currentWarehouseCode,
      receivedAt: schema.goodsReceiptItems.qcCheckedAt,
    }).from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.sku, peek.sku),
                 eq(schema.goodsReceiptItems.stockStatus, 'in_stock'),
                 isNotNull(schema.goodsReceiptItems.currentWarehouseCode)))
      .orderBy(asc(schema.goodsReceiptItems.id))
      .for('update');

    // 3) Giờ mới lock dòng đơn và RE-VALIDATE — trạng thái/SKU có thể đã
    //    đổi giữa bước đọc không lock và bước lock.
    const [line] = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, lineId))
      .for('update');
    if (!line || line.sku !== peek.sku) return false;
    if (line.status !== 'pending_check' && line.status !== 'out_of_stock') return false;

    // 4) Chọn món: kho nhiều món nhất (tie → GVM/AP/DM), trong kho lấy món
    //    nhận cũ nhất (FIFO).
    const chosen = pickItem(items.map((i) => ({
      id: i.id, warehouseCode: i.warehouseCode!, receivedAt: i.receivedAt,
    })));

    // 5) Không có món → out_of_stock (đi luồng brand như cũ).
    if (!chosen) {
      if (line.status === 'pending_check') {
        await tx.update(schema.orderFulfillmentLines)
          .set({ status: 'out_of_stock', updatedAt: sql`now()` })
          .where(eq(schema.orderFulfillmentLines.id, line.id));
        await tx.insert(schema.orderFulfillmentEvents).values({
          fulfillmentId: line.fulfillmentId, lineId: line.id,
          fromStatus: line.status, toStatus: 'out_of_stock',
          actor: ACTOR, note: 'Kho không đủ — chờ brand/nhập kho',
        });
        await recomputeRollup(tx, line.fulfillmentId);
      }
      return false;
    }

    // 6) Cấp: giữ MÓN cụ thể (allocated + link dòng), reserve qua ledger
    //    (refType item, refId = món), rồi chuyển dòng sang in_stock. v1 qty=1.
    await tx.update(schema.goodsReceiptItems)
      .set({ stockStatus: 'allocated', fulfillmentLineId: line.id, updatedAt: sql`now()` })
      .where(eq(schema.goodsReceiptItems.id, chosen.id));
    const invId = await applyMovement(tx, {
      sku: line.sku, warehouseCode: chosen.warehouseCode,
      deltaOnHand: 0, deltaReserved: 1,
      reason: 'auto_allocate', refType: 'item', refId: chosen.id,
      actor: ACTOR,
    });
    await tx.update(schema.orderFulfillmentLines)
      .set({ status: 'in_stock', warehouseInventoryId: invId, allocatedQty: 1, updatedAt: sql`now()` })
      .where(eq(schema.orderFulfillmentLines.id, line.id));
    await tx.insert(schema.orderFulfillmentEvents).values({
      fulfillmentId: line.fulfillmentId, lineId: line.id,
      fromStatus: line.status, toStatus: 'in_stock',
      actor: ACTOR, note: `Auto-pick kho ${chosen.warehouseCode}`,
    });
    // Dòng từng out_of_stock có thể đã mở brand request — huỷ bản chưa gửi/chưa confirm để khỏi bị sendPendingBrandRequests kéo ngược về brand_requested.
    await tx.delete(schema.brandOrderRequests)
      .where(and(eq(schema.brandOrderRequests.fulfillmentLineId, line.id),
                 eq(schema.brandOrderRequests.confirmStatus, 'awaiting')));
    await recomputeRollup(tx, line.fulfillmentId);
    return true;
  });
}

/** Hàng mới vào kho: cấp lại cho các dòng out_of_stock cùng SKU, đơn CŨ
 *  nhất trước (FIFO theo processedAtShopify). Trả về số dòng cấp được. */
export async function reallocateSku(sku: string): Promise<number> {
  const waiting = await db.select({
    lineId: schema.orderFulfillmentLines.id,
    orderProcessedAt: schema.shopifyOrders.processedAtShopify,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders,
      eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(eq(schema.orderFulfillmentLines.status, 'out_of_stock'),
               eq(schema.orderFulfillmentLines.sku, sku)));
  // Không ORDER BY trong SQL — fifoOrder() (đã test, xếp null cuối) là nguồn sắp xếp duy nhất.

  let granted = 0;
  for (const w of fifoOrder(waiting)) {
    // Đủ-hoặc-không từng dòng: dòng đầu fail nghĩa là tồn đã cạn — dừng.
    if (await allocateLine(w.lineId)) granted++;
    else break;
  }
  return granted;
}
