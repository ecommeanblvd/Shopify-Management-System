'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { checkStock, rollupOrderStatus, canTransitionLine, type StockInfo, type LineStatus } from './logic';

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

async function recomputeRollup(fulfillmentId: string): Promise<void> {
  const lines = await db.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await db.update(schema.orderFulfillment)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

/** Run/re-run stock check for a single order. Reserves stock for in_stock lines. */
export async function checkStockForOrder(orderId: string): Promise<void> {
  await requirePerm('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');

  const lines = await db.select().from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  const checkable = lines.filter((l) => l.status === 'pending_check' || l.status === 'out_of_stock' || l.status === 'in_stock');
  const skus = [...new Set(checkable.map((l) => l.sku).filter((s): s is string => !!s))];

  await db.transaction(async (tx) => {
    const inv = skus.length
      ? await tx.select().from(schema.warehouseInventory).where(inArray(schema.warehouseInventory.sku, skus))
      : [];
    const stock = new Map<string, StockInfo>(
      inv.map((w) => [w.sku, { available: w.qtyOnHand - w.qtyReserved, warehouseInventoryId: w.id }]),
    );
    for (const l of checkable) {
      if (l.status === 'in_stock' && l.warehouseInventoryId && l.allocatedQty > 0) {
        await tx.update(schema.warehouseInventory)
          .set({ qtyReserved: sql`${schema.warehouseInventory.qtyReserved} - ${l.allocatedQty}` })
          .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId));
        const cur = stock.get(l.sku!); if (cur) cur.available += l.allocatedQty;
      }
      const res = checkStock({ sku: l.sku, qty: l.qty }, stock);
      if (res.status === 'in_stock') {
        await tx.update(schema.warehouseInventory)
          .set({ qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${res.allocatedQty}` })
          .where(eq(schema.warehouseInventory.id, res.warehouseInventoryId!));
        const cur = stock.get(l.sku!); if (cur) cur.available -= res.allocatedQty;
      }
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: res.status, warehouseInventoryId: res.warehouseInventoryId, allocatedQty: res.allocatedQty, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
    }
  });
  await recomputeRollup(ful.id);
  revalidatePath('/f/fulfillment');
  revalidatePath(`/f/fulfillment/${orderId}`);
}

/** Advance one line: in_stock->picked (decrement stock) ->packed->shipped. */
export async function markLine(lineId: string, next: LineStatus): Promise<void> {
  const actor = await requirePerm('manage_fulfillment');
  const [l] = await db.select().from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.id, lineId)).limit(1);
  if (!l) throw new Error('Line not found');
  if (!canTransitionLine(l.status as LineStatus, next)) throw new Error(`Invalid transition ${l.status} -> ${next}`);

  await db.transaction(async (tx) => {
    if (next === 'picked' && l.warehouseInventoryId && l.allocatedQty > 0) {
      await tx.update(schema.warehouseInventory)
        .set({
          qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} - ${l.allocatedQty}`,
          qtyReserved: sql`${schema.warehouseInventory.qtyReserved} - ${l.allocatedQty}`,
        })
        .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId));
    }
    const stamp = next === 'picked' ? { pickedAt: sql`now()` } : next === 'packed' ? { packedAt: sql`now()` } : { shippedAt: sql`now()` };
    await tx.update(schema.orderFulfillmentLines)
      .set({ status: next, updatedAt: sql`now()`, ...stamp })
      .where(eq(schema.orderFulfillmentLines.id, lineId));
    await tx.insert(schema.orderFulfillmentEvents)
      .values({ fulfillmentId: l.fulfillmentId, lineId, fromStatus: l.status, toStatus: next, actor });
  });
  await recomputeRollup(l.fulfillmentId);
  revalidatePath('/f/fulfillment');
}

/** Apply `next` to every line of an order that can legally advance to it. */
export async function markOrder(orderId: string, next: LineStatus): Promise<void> {
  await requirePerm('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');
  const lines = await db.select().from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  for (const l of lines) {
    if (canTransitionLine(l.status as LineStatus, next)) await markLine(l.id, next);
  }
}

/** RBAC-gated wrapper to backfill ops records for pre-existing orders. */
export async function runBackfillFulfillment(): Promise<number> {
  await requirePerm('manage_fulfillment');
  const { backfillFulfillmentRecords } = await import('./ensure-fulfillment');
  return backfillFulfillmentRecords();
}
