'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { checkStock, canTransitionLine, type StockInfo, type LineStatus } from './logic';
import { recomputeRollup } from './rollup';
import { sendBrandRequest } from '@/features/mmp/outbound';
import { applyMovement } from '@/features/warehouse/ledger';

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
    // Stock leaves through the ledger (applyMovement validates the invariants
    // and writes the inventory_movements row). The inventory lock is taken
    // here, BEFORE this tx touches the fulfillment-line row below — matching
    // the inventory→line lock order used by allocateLine/checkStockForOrder.
    const [inv] = await tx.select({ sku: schema.warehouseInventory.sku, wh: schema.warehouseInventory.warehouseCode })
      .from(schema.warehouseInventory)
      .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId)).limit(1);
    if (inv) {
      await applyMovement(tx, {
        sku: inv.sku, warehouseCode: inv.wh,
        deltaOnHand: -l.allocatedQty, deltaReserved: -l.allocatedQty,
        reason: 'pick', refType: 'fulfillment_line', refId: l.id, actor,
      });
    }
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
  const actor = await requirePerm('manage_fulfillment');
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) throw new Error('No fulfillment record');

  await db.transaction(async (tx) => {
    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
    const checkable = lines.filter((l) => l.status === 'pending_check' || l.status === 'out_of_stock' || l.status === 'in_stock');
    const skus = [...new Set(checkable.map((l) => l.sku).filter((s): s is string => !!s))];

    // Lock the relevant inventory rows so concurrent checks can't double-reserve.
    // ORDER BY id keeps the multi-row lock order deterministic across callers.
    const inv = skus.length
      ? await tx.select().from(schema.warehouseInventory).where(inArray(schema.warehouseInventory.sku, skus)).orderBy(asc(schema.warehouseInventory.id)).for('update')
      : [];
    // Extended entry that carries sku+warehouseCode so applyMovement can be
    // called without a second lookup — the locked inv rows already have them.
    type InvEntry = StockInfo & { sku: string; warehouseCode: string };
    const bySku = new Map<string, InvEntry>();
    const byId = new Map<string, InvEntry>();
    for (const w of inv) {
      const entry: InvEntry = { available: w.qtyOnHand - w.qtyReserved, warehouseInventoryId: w.id, sku: w.sku, warehouseCode: w.warehouseCode };
      bySku.set(w.sku, entry);
      byId.set(w.id, entry);
    }

    for (const l of checkable) {
      // Release any prior reservation through the ledger (row already locked
      // FOR UPDATE above — applyMovement re-locks the same row, no-op extra lock).
      if (l.status === 'in_stock' && l.warehouseInventoryId && l.allocatedQty > 0) {
        const cur = byId.get(l.warehouseInventoryId);
        if (cur) {
          await applyMovement(tx, {
            sku: cur.sku, warehouseCode: cur.warehouseCode,
            deltaOnHand: 0, deltaReserved: -l.allocatedQty,
            reason: 'release_allocation', refType: 'fulfillment_line', refId: l.id, actor,
          });
          cur.available += l.allocatedQty;
        } else {
          // SKU của dòng đã đổi sau khi cấp → dòng tồn CŨ không nằm trong tập
          // đã lock theo SKU ở trên. Vẫn phải nhả qua ledger (applyMovement tự
          // lock dòng đó), nếu không reserved rò rỉ vĩnh viễn khi dòng đơn bị
          // ghi đè bên dưới.
          const [old] = await tx.select({ sku: schema.warehouseInventory.sku, warehouseCode: schema.warehouseInventory.warehouseCode })
            .from(schema.warehouseInventory)
            .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId)).limit(1);
          if (old) {
            await applyMovement(tx, {
              sku: old.sku, warehouseCode: old.warehouseCode,
              deltaOnHand: 0, deltaReserved: -l.allocatedQty,
              reason: 'release_allocation', refType: 'fulfillment_line', refId: l.id, actor,
            });
          }
        }
      }
      const res = checkStock({ sku: l.sku, qty: l.qty }, bySku);
      if (res.status === 'in_stock') {
        const cur = byId.get(res.warehouseInventoryId!);
        if (cur) {
          await applyMovement(tx, {
            sku: cur.sku, warehouseCode: cur.warehouseCode,
            deltaOnHand: 0, deltaReserved: res.allocatedQty,
            reason: 'auto_allocate', refType: 'fulfillment_line', refId: l.id, actor,
          });
          cur.available -= res.allocatedQty;
        }
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
