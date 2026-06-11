/** Auto-allocation hai chiều (spec §4a/§4b):
 *  docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md
 *  Best-effort: lỗi không được phá sync đơn — caller bọc try/catch. */
import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { planAllocation, fifoOrder } from './allocation-logic';
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
  const lines = await db.select({ id: schema.orderFulfillmentLines.id, sku: schema.orderFulfillmentLines.sku })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .where(and(eq(schema.orderFulfillment.orderId, orderId),
               eq(schema.orderFulfillmentLines.status, 'pending_check')));
  for (const line of lines) {
    if (!line.sku) continue;
    await allocateLine(line.id);
  }
}

/** Cấp MỘT dòng trong transaction riêng. Trả về true nếu cấp được. */
export async function allocateLine(lineId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    // 1) Lock dòng đơn — chặn hai allocator cùng cấp một dòng.
    const [line] = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.id, lineId))
      .for('update');
    if (!line || !line.sku) return false;
    if (line.status !== 'pending_check' && line.status !== 'out_of_stock') return false;

    // 2) Lock các dòng tồn của SKU rồi lập kế hoạch cấp.
    const stocks = await tx.select().from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.sku, line.sku))
      .for('update');
    const plan = planAllocation({ qty: line.qty }, toCandidates(stocks));

    // 3) Không đủ tồn: pending_check -> out_of_stock (đi luồng brand như cũ).
    if (!plan) {
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

    // 4) Đủ tồn: reserve qua ledger rồi chuyển dòng sang in_stock.
    const invId = await applyMovement(tx, {
      sku: line.sku, warehouseCode: plan.warehouseCode,
      deltaOnHand: 0, deltaReserved: plan.qty,
      reason: 'auto_allocate', refType: 'fulfillment_line', refId: line.id,
      actor: ACTOR,
    });
    await tx.update(schema.orderFulfillmentLines)
      .set({ status: 'in_stock', warehouseInventoryId: invId, allocatedQty: plan.qty, updatedAt: sql`now()` })
      .where(eq(schema.orderFulfillmentLines.id, line.id));
    await tx.insert(schema.orderFulfillmentEvents).values({
      fulfillmentId: line.fulfillmentId, lineId: line.id,
      fromStatus: line.status, toStatus: 'in_stock',
      actor: ACTOR, note: `Auto-pick kho ${plan.warehouseCode}`,
    });
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
               eq(schema.orderFulfillmentLines.sku, sku)))
    .orderBy(asc(schema.shopifyOrders.processedAtShopify));

  let granted = 0;
  for (const w of fifoOrder(waiting)) {
    // Đủ-hoặc-không từng dòng: dòng đầu fail nghĩa là tồn đã cạn — dừng.
    if (await allocateLine(w.lineId)) granted++;
    else break;
  }
  return granted;
}
