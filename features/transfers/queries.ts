import { eq, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@/db/client';

/** Active warehouses for the from/to selectors. */
export async function listWarehouses() {
  return db.select({ id: schema.warehouses.id, code: schema.warehouses.code, name: schema.warehouses.name })
    .from(schema.warehouses)
    .where(eq(schema.warehouses.isActive, true))
    .orderBy(schema.warehouses.code);
}

/** Transfers newest first, with from/to codes and their lines. */
export async function listTransfers() {
  const fromWh = alias(schema.warehouses, 'from_wh');
  const toWh = alias(schema.warehouses, 'to_wh');
  const rows = await db.select({
    id: schema.inventoryTransfers.id,
    code: schema.inventoryTransfers.code,
    status: schema.inventoryTransfers.status,
    fromCode: fromWh.code,
    toCode: toWh.code,
    note: schema.inventoryTransfers.note,
    sentAt: schema.inventoryTransfers.sentAt,
    receivedAt: schema.inventoryTransfers.receivedAt,
    createdAt: schema.inventoryTransfers.createdAt,
  })
    .from(schema.inventoryTransfers)
    .innerJoin(fromWh, eq(fromWh.id, schema.inventoryTransfers.fromWarehouseId))
    .innerJoin(toWh, eq(toWh.id, schema.inventoryTransfers.toWarehouseId))
    .orderBy(desc(schema.inventoryTransfers.createdAt));

  const lines = await db.select({
    transferId: schema.inventoryTransferLines.transferId,
    sku: schema.inventoryTransferLines.sku,
    productTitle: schema.inventoryTransferLines.productTitle,
    qty: schema.inventoryTransferLines.qty,
  }).from(schema.inventoryTransferLines);

  return rows.map((r) => ({ ...r, lines: lines.filter((l) => l.transferId === r.id) }));
}
