/** Nhả reservation khi đơn huỷ / dòng biến mất, rồi đưa hàng cho đơn chờ kế. */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { applyMovement } from './ledger';

export async function releaseOrderAllocations(orderId: string, actor = 'system:release'): Promise<void> {
  const released: string[] = [];
  await db.transaction(async (tx) => {
    // Đọc danh sách dòng KHÔNG lock — applyMovement bên dưới lock TỒN KHO
    // trước, rồi mới update dòng đơn: đúng thứ tự inventory→line toàn hệ.
    const lines = await tx.select({
      id: schema.orderFulfillmentLines.id,
      sku: schema.orderFulfillmentLines.sku,
      allocatedQty: schema.orderFulfillmentLines.allocatedQty,
      invId: schema.orderFulfillmentLines.warehouseInventoryId,
    })
      .from(schema.orderFulfillmentLines)
      .innerJoin(schema.orderFulfillment,
        eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
      .where(and(eq(schema.orderFulfillment.orderId, orderId),
                 eq(schema.orderFulfillmentLines.status, 'in_stock')));
    for (const l of lines) {
      if (!l.invId || l.allocatedQty <= 0 || !l.sku) continue;
      const [inv] = await tx.select({ sku: schema.warehouseInventory.sku, wh: schema.warehouseInventory.warehouseCode })
        .from(schema.warehouseInventory).where(eq(schema.warehouseInventory.id, l.invId)).limit(1);
      if (!inv) continue;
      await applyMovement(tx, {
        sku: inv.sku, warehouseCode: inv.wh,
        deltaOnHand: 0, deltaReserved: -l.allocatedQty,
        reason: 'release_allocation', refType: 'order', refId: orderId, actor,
      });
      await tx.update(schema.orderFulfillmentLines)
        .set({ warehouseInventoryId: null, allocatedQty: 0, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      released.push(l.sku);
    }
  });
  // Hàng vừa nhả → đơn chờ kế (ngoài tx, mỗi SKU một lần), best-effort.
  const { reallocateSku } = await import('./allocate');
  for (const sku of [...new Set(released)]) {
    try { await reallocateSku(sku); } catch (e) { console.error('reallocate after release:', e); }
  }
}
