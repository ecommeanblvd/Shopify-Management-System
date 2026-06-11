/** Cổng DUY NHẤT chỉnh tồn kho: lock dòng tồn, kiểm bất biến, ghi movement,
 *  cập nhật tổng — tất cả trong transaction của caller. */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { validateMovement } from './allocation-logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface MovementDraft {
  sku: string;
  warehouseCode: string;
  deltaOnHand: number;
  deltaReserved: number;
  reason: 'receipt_po' | 'receipt_consignment' | 'receipt_return' | 'auto_allocate'
    | 'release_allocation' | 'pick' | 'manual_adjust' | 'transfer_in' | 'transfer_out' | 'migration';
  refType?: 'receipt_item' | 'fulfillment_line' | 'order' | 'transfer' | 'item';
  /** UUID của bản ghi tham chiếu (cột DB là uuid — KHÔNG truyền GID/chuỗi thường). */
  refId?: string | null;
  note?: string | null;
  actor: string;
  /** Tự tạo dòng tồn nếu chưa có (nhập kho lần đầu cho SKU×kho). */
  createIfMissing?: { productTitle?: string | null; variantTitle?: string | null };
}

/** Trả về id dòng tồn đã chạm. Throw khi vi phạm bất biến. */
export async function applyMovement(tx: Tx, d: MovementDraft): Promise<string> {
  // 1) Lock (hoặc tạo) dòng tồn — FOR UPDATE chặn hai allocator tranh nhau.
  let [inv] = await tx.select().from(schema.warehouseInventory)
    .where(and(eq(schema.warehouseInventory.sku, d.sku),
               eq(schema.warehouseInventory.warehouseCode, d.warehouseCode)))
    .for('update');
  if (!inv) {
    if (!d.createIfMissing) throw new Error(`Không có dòng tồn ${d.sku}@${d.warehouseCode}`);
    const inserted = await tx.insert(schema.warehouseInventory)
      .values({ sku: d.sku, warehouseCode: d.warehouseCode,
                productTitle: d.createIfMissing.productTitle ?? null,
                variantTitle: d.createIfMissing.variantTitle ?? null,
                updatedBy: d.actor })
      .onConflictDoNothing().returning();
    inv = inserted[0];
    if (!inv) { // thua race tạo dòng — đọc lại có lock
      [inv] = await tx.select().from(schema.warehouseInventory)
        .where(and(eq(schema.warehouseInventory.sku, d.sku),
                   eq(schema.warehouseInventory.warehouseCode, d.warehouseCode)))
        .for('update');
    }
  }
  if (!inv) throw new Error(`Không có dòng tồn ${d.sku}@${d.warehouseCode} (race)`);
  // 2) Bất biến (logic thuần đã test ở allocation-logic)
  const v = validateMovement(inv, d);
  if (!v.ok) throw new Error(`Movement ${d.reason} ${d.sku}@${d.warehouseCode}: ${v.error}`);
  // 3) Ledger + tổng
  await tx.insert(schema.inventoryMovements).values({
    warehouseInventoryId: inv.id,
    deltaOnHand: d.deltaOnHand, deltaReserved: d.deltaReserved,
    reason: d.reason, refType: d.refType ?? null, refId: d.refId ?? null,
    note: d.note ?? null, actor: d.actor,
  });
  await tx.update(schema.warehouseInventory).set({
    qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${d.deltaOnHand}`,
    qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${d.deltaReserved}`,
    updatedBy: d.actor, updatedAt: sql`now()`,
  }).where(eq(schema.warehouseInventory.id, inv.id));
  return inv.id;
}
