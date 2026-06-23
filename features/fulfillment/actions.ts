'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { canTransitionLine, type LineStatus } from './logic';
import { recomputeRollup } from './rollup';
import { sendBrandRequest } from '@/features/mmp/outbound';
import { pushOrderToMmp } from '@/features/mmp/order-outbound';
import { applyMovement } from '@/features/warehouse/ledger';
import { pickItem } from '@/features/warehouse/allocation-logic';
import { verifyAndStoreOrderAddress } from '@/features/shopify-orders/address-verify';

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
    // Per-unit (spec §3): món rời kho — tìm + lock MÓN đang giữ cho dòng này
    // (phía inventory) TRƯỚC khi tx chạm dòng đơn bên dưới, giữ thứ tự
    // inventory→line như allocateLine/checkStockForOrder/release.
    const [item] = await tx.select({
      id: schema.goodsReceiptItems.id,
      sku: schema.goodsReceiptItems.sku,
      wh: schema.goodsReceiptItems.currentWarehouseCode,
    })
      .from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, l.id),
                 eq(schema.goodsReceiptItems.stockStatus, 'allocated')))
      .orderBy(asc(schema.goodsReceiptItems.id))
      .limit(1).for('update');
    if (item && item.sku && item.wh) {
      // v1 mỗi dòng giữ đúng 1 món → trừ đúng 1 onHand + 1 reserved.
      await tx.update(schema.goodsReceiptItems)
        .set({ stockStatus: 'picked', updatedAt: sql`now()` })
        .where(eq(schema.goodsReceiptItems.id, item.id));
      await applyMovement(tx, {
        sku: item.sku, warehouseCode: item.wh,
        deltaOnHand: -1, deltaReserved: -1,
        reason: 'pick', refType: 'item', refId: item.id, actor,
      });
    }
  }
  if (next === 'shipped') {
    // Món đã pick rời kho — đánh dấu shipped (nếu tồn tại). Không movement:
    // pick đã trừ onHand+reserved; shipped chỉ là vòng đời món.
    await tx.update(schema.goodsReceiptItems)
      .set({ stockStatus: 'shipped', updatedAt: sql`now()` })
      .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, l.id),
                 eq(schema.goodsReceiptItems.stockStatus, 'picked')));
  }
  const stamp = next === 'picked' ? { pickedAt: sql`now()` } : next === 'packed' ? { packedAt: sql`now()` } : { shippedAt: sql`now()` };
  // Update CÓ GUARD trên trạng thái cũ: hai pick đồng thời cùng qua được
  // canTransitionLine (đọc ngoài lock) — bản thua phải fail Ở ĐÂY để rollback
  // movement 'pick' phía trên, không thì trừ tồn hai lần.
  const updated = await tx.update(schema.orderFulfillmentLines)
    .set({ status: next, updatedAt: sql`now()`, ...stamp })
    .where(and(eq(schema.orderFulfillmentLines.id, l.id),
               eq(schema.orderFulfillmentLines.status, l.status)))
    .returning({ id: schema.orderFulfillmentLines.id });
  if (updated.length === 0) throw new Error(`Dòng đã bị thao tác đồng thời (${l.status} → ${next}) — tải lại và thử lại`);
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
    const checkableIds = checkable.map((l) => l.id);

    // Per-unit (spec §3): cùng mô hình với allocateLine — đặt giữ ĐÚNG MÓN
    // cụ thể, không chỉ tăng reserved trên rollup. Khoá MÓN (phía inventory)
    // TRƯỚC khi chạm dòng đơn — giữ thứ tự inventory→line toàn hệ; ORDER BY id
    // để thứ tự khoá nhiều món xác định, hai checkStock không vòng chờ.
    // Tập khoá: (a) món in_stock của các SKU liên quan (ứng viên để cấp), và
    // (b) món allocated đang gắn các dòng đang xét (để nhả lại trước khi cấp
    // lại). Một câu lock duy nhất theo id để thứ tự nhất quán.
    const items = (skus.length || checkableIds.length)
      ? await tx.select({
          id: schema.goodsReceiptItems.id,
          sku: schema.goodsReceiptItems.sku,
          wh: schema.goodsReceiptItems.currentWarehouseCode,
          stockStatus: schema.goodsReceiptItems.stockStatus,
          fulfillmentLineId: schema.goodsReceiptItems.fulfillmentLineId,
          receivedAt: schema.goodsReceiptItems.qcCheckedAt,
        }).from(schema.goodsReceiptItems)
          .where(and(
            isNotNull(schema.goodsReceiptItems.currentWarehouseCode),
            or(
              skus.length
                ? and(eq(schema.goodsReceiptItems.stockStatus, 'in_stock'),
                      inArray(schema.goodsReceiptItems.sku, skus))
                : sql`false`,
              checkableIds.length
                ? and(eq(schema.goodsReceiptItems.stockStatus, 'allocated'),
                      inArray(schema.goodsReceiptItems.fulfillmentLineId, checkableIds))
                : sql`false`,
            ),
          ))
          .orderBy(asc(schema.goodsReceiptItems.id)).for('update')
      : [];

    type PoolItem = { id: string; warehouseCode: string; receivedAt: Date | null };
    // Pool món in_stock khả dụng theo SKU (cập nhật tại chỗ khi cấp/nhả trong tx).
    const available = new Map<string, PoolItem[]>();
    // Món đang allocated cho từng dòng (để nhả).
    const allocatedByLine = new Map<string, { id: string; sku: string; wh: string }>();
    for (const it of items) {
      if (!it.sku || !it.wh) continue;
      if (it.stockStatus === 'in_stock') {
        const list = available.get(it.sku) ?? [];
        list.push({ id: it.id, warehouseCode: it.wh, receivedAt: it.receivedAt });
        available.set(it.sku, list);
      } else if (it.stockStatus === 'allocated' && it.fulfillmentLineId) {
        allocatedByLine.set(it.fulfillmentLineId, { id: it.id, sku: it.sku, wh: it.wh });
      }
    }

    for (const l of checkable) {
      // Nhả reservation cũ (nếu có) — trả MÓN về in_stock + −reserved, rồi đưa
      // lại vào pool để có thể được cấp lại ngay trong lần check này.
      if (l.status === 'in_stock' && l.warehouseInventoryId && l.allocatedQty > 0) {
        const prev = allocatedByLine.get(l.id);
        if (prev) {
          await tx.update(schema.goodsReceiptItems)
            .set({ stockStatus: 'in_stock', fulfillmentLineId: null, updatedAt: sql`now()` })
            .where(eq(schema.goodsReceiptItems.id, prev.id));
          await applyMovement(tx, {
            sku: prev.sku, warehouseCode: prev.wh,
            deltaOnHand: 0, deltaReserved: -1,
            reason: 'release_allocation', refType: 'item', refId: prev.id, actor,
          });
          allocatedByLine.delete(l.id);
          const list = available.get(prev.sku) ?? [];
          list.push({ id: prev.id, warehouseCode: prev.wh, receivedAt: null });
          available.set(prev.sku, list);
        } else {
          // Drift: dòng in_stock có reserved trên rollup nhưng KHÔNG còn món
          // allocated trỏ về nó (vd pick đồng thời vừa chuyển món sang picked).
          // Vẫn phải nhả reserved cũ trên đúng rollup row (l.warehouseInventoryId)
          // trước khi ghi đè bên dưới — nếu không reserved rò vĩnh viễn.
          const [inv] = await tx.select({ sku: schema.warehouseInventory.sku, wh: schema.warehouseInventory.warehouseCode })
            .from(schema.warehouseInventory)
            .where(eq(schema.warehouseInventory.id, l.warehouseInventoryId)).limit(1);
          if (inv) {
            await applyMovement(tx, {
              sku: inv.sku, warehouseCode: inv.wh,
              deltaOnHand: 0, deltaReserved: -l.allocatedQty,
              reason: 'release_allocation', refType: 'fulfillment_line', refId: l.id, actor,
            });
          }
        }
      }
      // Chọn đúng món như allocateLine: kho nhiều món nhất (tie GVM/AP/DM),
      // FIFO. v1 qty=1 mỗi dòng — chỉ cấp 1 món (xem allocateLine).
      let res: { status: LineStatus; warehouseInventoryId: string | null; allocatedQty: number } =
        { status: 'out_of_stock', warehouseInventoryId: null, allocatedQty: 0 };
      let chosenItem: PoolItem | null = null;
      if (l.sku) {
        const pool = available.get(l.sku) ?? [];
        chosenItem = pickItem(pool);
      }
      if (l.sku && chosenItem) {
        const invId = await applyMovement(tx, {
          sku: l.sku, warehouseCode: chosenItem.warehouseCode,
          deltaOnHand: 0, deltaReserved: 1,
          reason: 'auto_allocate', refType: 'item', refId: chosenItem.id, actor,
        });
        await tx.update(schema.goodsReceiptItems)
          .set({ stockStatus: 'allocated', fulfillmentLineId: l.id, updatedAt: sql`now()` })
          .where(eq(schema.goodsReceiptItems.id, chosenItem.id));
        // Rút món khỏi pool để dòng sau không cấp trùng.
        const pool = available.get(l.sku) ?? [];
        available.set(l.sku, pool.filter((p) => p.id !== chosenItem!.id));
        res = { status: 'in_stock', warehouseInventoryId: invId, allocatedQty: 1 };
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
  try { await pushOrderToMmp(orderId); } catch (e) { console.error(`pushOrderToMmp failed for ${orderId}:`, e); }
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

export async function verifyOrderAddressAction(
  orderId: string,
): Promise<{ ok: boolean; deliverable?: boolean; issue?: string | null; error?: string }> {
  await requirePerm('manage_fulfillment');
  const r = await verifyAndStoreOrderAddress(orderId);
  revalidatePath(`/f/fulfillment/${orderId}`);
  return r;
}
