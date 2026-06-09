'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { checkStock, rollupOrderStatus, canTransitionLine, type StockInfo, type LineStatus } from './logic';
import { sendBrandRequest } from '@/features/mmp/outbound';

/** A drizzle transaction handle (same query surface as `db`). */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** A persisted fulfillment line row. */
type LineRow = typeof schema.orderFulfillmentLines.$inferSelect;

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

/** Recompute + persist the order rollup status. MUST run inside the same tx
 *  as the line mutation so concurrent transitions can't leave a torn status. */
async function recomputeRollup(tx: Tx, fulfillmentId: string): Promise<void> {
  const lines = await tx.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await tx.update(schema.orderFulfillment)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

/** Send any pending brand requests for an order (fire after commit; failures
 *  are recorded on the row, never thrown — they don't break the stock check). */
async function sendPendingBrandRequests(orderId: string): Promise<void> {
  const [ord] = await db.select({ number: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  const orderNumber = ord?.number ?? '';

  const pending = await db.select({ id: schema.brandOrderRequests.id })
    .from(schema.brandOrderRequests)
    .where(and(eq(schema.brandOrderRequests.orderId, orderId), eq(schema.brandOrderRequests.sendStatus, 'pending')));

  for (const p of pending) {
    // Atomic claim: only one concurrent caller flips pending -> sent and gets the row.
    const claimed = await db.update(schema.brandOrderRequests)
      .set({ sendStatus: 'sent', sentAt: sql`now()`, sendAttempts: sql`${schema.brandOrderRequests.sendAttempts} + 1`, updatedAt: sql`now()` })
      .where(and(eq(schema.brandOrderRequests.id, p.id), eq(schema.brandOrderRequests.sendStatus, 'pending')))
      .returning({ id: schema.brandOrderRequests.id, fulfillmentLineId: schema.brandOrderRequests.fulfillmentLineId, sku: schema.brandOrderRequests.sku, qty: schema.brandOrderRequests.qty });
    if (claimed.length === 0) continue; // another run already claimed it
    const r = claimed[0];

    const [line] = await db.select({ vendor: schema.shopifyOrderLines.vendor })
      .from(schema.orderFulfillmentLines)
      .innerJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
      .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId)).limit(1);
    const brandSlug = line?.vendor ?? null;

    const result = await sendBrandRequest({ id: r.id, brandSlug, sku: r.sku, qty: r.qty }, orderNumber);
    if (result.ok) {
      await db.update(schema.brandOrderRequests)
        .set({ brandSlug, externalRef: result.externalRef ?? null, lastError: null, updatedAt: sql`now()` })
        .where(eq(schema.brandOrderRequests.id, r.id)); // stays 'sent'
      await db.update(schema.orderFulfillmentLines)
        .set({ status: 'brand_requested', updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, r.fulfillmentLineId));
    } else {
      await db.update(schema.brandOrderRequests)
        .set({ brandSlug, sendStatus: 'failed', lastError: result.error ?? 'failed', updatedAt: sql`now()` })
        .where(eq(schema.brandOrderRequests.id, r.id));
    }
  }
}

/** Apply a single validated line transition within a transaction. Decrements
 *  stock on 'picked'. Caller MUST have validated canTransitionLine first. */
async function applyLineTransition(tx: Tx, l: LineRow, next: LineStatus, actor: string): Promise<void> {
  if (next === 'picked' && l.warehouseInventoryId && l.allocatedQty > 0) {
    // The CHECK constraints (qty_on_hand >= 0, qty_reserved >= 0) make this
    // throw + roll back rather than corrupt counts if stock went short.
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
    .where(eq(schema.orderFulfillmentLines.id, l.id));
  await tx.insert(schema.orderFulfillmentEvents)
    .values({ fulfillmentId: l.fulfillmentId, lineId: l.id, fromStatus: l.status, toStatus: next, actor });
}

/** Run/re-run stock check for a single order. Reserves stock for in_stock lines. */
export async function checkStockForOrder(orderId: string): Promise<void> {
  await requirePerm('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');

  await db.transaction(async (tx) => {
    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
    const checkable = lines.filter((l) => l.status === 'pending_check' || l.status === 'out_of_stock' || l.status === 'in_stock');
    const skus = [...new Set(checkable.map((l) => l.sku).filter((s): s is string => !!s))];

    // Lock the relevant inventory rows so concurrent checks can't double-reserve.
    const inv = skus.length
      ? await tx.select().from(schema.warehouseInventory).where(inArray(schema.warehouseInventory.sku, skus)).for('update')
      : [];
    // Share one entry object per warehouse row, indexed by both sku and id.
    const bySku = new Map<string, StockInfo>();
    const byId = new Map<string, StockInfo>();
    for (const w of inv) {
      const entry: StockInfo = { available: w.qtyOnHand - w.qtyReserved, warehouseInventoryId: w.id };
      bySku.set(w.sku, entry);
      byId.set(w.id, entry);
    }

    for (const l of checkable) {
      // Release any prior reservation before re-evaluating (key by id, robust).
      if (l.status === 'in_stock' && l.warehouseInventoryId && l.allocatedQty > 0) {
        await tx.update(schema.warehouseInventory)
          .set({ qtyReserved: sql`${schema.warehouseInventory.qtyReserved} - ${l.allocatedQty}` })
          .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId));
        const cur = byId.get(l.warehouseInventoryId);
        if (cur) cur.available += l.allocatedQty;
      }
      const res = checkStock({ sku: l.sku, qty: l.qty }, bySku);
      if (res.status === 'in_stock') {
        await tx.update(schema.warehouseInventory)
          .set({ qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${res.allocatedQty}` })
          .where(eq(schema.warehouseInventory.id, res.warehouseInventoryId!));
        const cur = byId.get(res.warehouseInventoryId!);
        if (cur) cur.available -= res.allocatedQty;
      }
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: res.status, warehouseInventoryId: res.warehouseInventoryId, allocatedQty: res.allocatedQty, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      if (res.status === 'out_of_stock') {
        await tx.insert(schema.brandOrderRequests)
          .values({ fulfillmentLineId: l.id, orderId, brandSlug: null, sku: l.sku, qty: l.qty })
          .onConflictDoNothing({ target: schema.brandOrderRequests.fulfillmentLineId });
      } else if (res.status === 'in_stock') {
        await tx.delete(schema.brandOrderRequests)
          .where(and(eq(schema.brandOrderRequests.fulfillmentLineId, l.id), eq(schema.brandOrderRequests.confirmStatus, 'awaiting')));
      }
    }
    await recomputeRollup(tx, ful.id);
  });
  await sendPendingBrandRequests(orderId);
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
    await applyLineTransition(tx, l, next, actor);
    await recomputeRollup(tx, l.fulfillmentId);
  });
  revalidatePath('/f/fulfillment');
}

/** Apply `next` to every line of an order that can legally advance — atomically. */
export async function markOrder(orderId: string, next: LineStatus): Promise<void> {
  const actor = await requirePerm('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');

  await db.transaction(async (tx) => {
    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
    for (const l of lines) {
      if (canTransitionLine(l.status as LineStatus, next)) {
        await applyLineTransition(tx, l, next, actor);
      }
    }
    await recomputeRollup(tx, ful.id);
  });
  revalidatePath('/f/fulfillment');
  revalidatePath(`/f/fulfillment/${orderId}`);
}

/** RBAC-gated wrapper to backfill ops records for pre-existing orders. */
export async function runBackfillFulfillment(): Promise<number> {
  await requirePerm('manage_fulfillment');
  const { backfillFulfillmentRecords } = await import('./ensure-fulfillment');
  return backfillFulfillmentRecords();
}
