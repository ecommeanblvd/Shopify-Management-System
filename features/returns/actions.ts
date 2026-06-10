'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { nextReturnCode, validateReturnDraft, validateReturnQc, restockEffect } from './logic';

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

export interface CreateReturnInput {
  orderId: string;
  note?: string | null;
  lines: { shopifyLineId: string; returnedQty: number }[];
}

/** Create an 'open' return record for an order, snapshotting line sku/titles. */
export async function createReturn(input: CreateReturnInput): Promise<string> {
  const userId = await requirePerm('manage_returns');
  const v = validateReturnDraft(input);
  if (!v.ok) throw new Error(v.error);

  const id = await db.transaction(async (tx) => {
    const [order] = await tx.select({
      id: schema.shopifyOrders.id,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    }).from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, input.orderId)).limit(1);
    if (!order) throw new Error('Đơn hàng không tồn tại');

    // per-order sequence = number of existing returns (any status) + 1
    const existing = await tx.select({ id: schema.customerReturns.id })
      .from(schema.customerReturns).where(eq(schema.customerReturns.orderId, input.orderId));
    const code = nextReturnCode(order.orderNumber, existing.length + 1);

    const orderLines = await tx.select({
      shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
      sku: schema.shopifyOrderLines.sku,
      productTitle: schema.shopifyOrderLines.productTitle,
      variantTitle: schema.shopifyOrderLines.variantTitle,
    }).from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, input.orderId));

    const [ret] = await tx.insert(schema.customerReturns).values({
      code, orderId: input.orderId, note: input.note ?? null, receivedBy: userId,
    }).returning({ id: schema.customerReturns.id });

    await tx.insert(schema.customerReturnLines).values(input.lines.map((l) => {
      const ol = orderLines.find((o) => o.shopifyLineId === l.shopifyLineId);
      return {
        returnId: ret.id,
        shopifyLineId: l.shopifyLineId,
        sku: ol?.sku ?? null,
        productTitle: ol?.productTitle ?? null,
        variantTitle: ol?.variantTitle ?? null,
        returnedQty: l.returnedQty,
      };
    }));
    return ret.id;
  });

  try { await recordAudit({ userId, action: 'return_create', target: id, requestSummary: `lines=${input.lines.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/returns');
  return id;
}

export interface SubmitReturnQcInput {
  returnId: string;
  lines: { lineId: string; passQty: number; failQty: number; failReason?: string | null }[];
}

/** Record QC outcomes, restock passed units to warehouse inventory, mark completed. */
export async function submitReturnQc(input: SubmitReturnQcInput): Promise<void> {
  const userId = await requirePerm('manage_returns');

  await db.transaction(async (tx) => {
    const [ret] = await tx.select().from(schema.customerReturns)
      .where(eq(schema.customerReturns.id, input.returnId)).limit(1);
    if (!ret) throw new Error('Phiếu không tồn tại');
    if (ret.status !== 'open') throw new Error('Phiếu đã QC hoặc đã huỷ');

    const lines = await tx.select().from(schema.customerReturnLines)
      .where(eq(schema.customerReturnLines.returnId, input.returnId));

    const merged = input.lines.map((qc) => {
      const line = lines.find((l) => l.id === qc.lineId);
      if (!line) throw new Error('Dòng QC không thuộc phiếu');
      return { line, qc };
    });

    const v = validateReturnQc(merged.map((m) => ({
      returnedQty: m.line.returnedQty, passQty: m.qc.passQty, failQty: m.qc.failQty,
    })));
    if (!v.ok) throw new Error(v.error);

    for (const { line, qc } of merged) {
      const eff = restockEffect({ sku: line.sku, passQty: qc.passQty });
      let inventoryRowId: string | null = line.warehouseInventoryId;
      if (line.sku && eff.onHandDelta > 0) {
        const [inv] = await tx.insert(schema.warehouseInventory)
          .values({
            sku: line.sku, productTitle: line.productTitle, variantTitle: line.variantTitle,
            qtyOnHand: eff.onHandDelta, updatedBy: userId,
          })
          .onConflictDoUpdate({
            target: schema.warehouseInventory.sku,
            set: {
              qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${eff.onHandDelta}`,
              updatedBy: userId, updatedAt: sql`now()`,
            },
          })
          .returning({ id: schema.warehouseInventory.id });
        inventoryRowId = inv.id;
      }
      await tx.update(schema.customerReturnLines).set({
        passQty: qc.passQty, failQty: qc.failQty, failReason: qc.failReason ?? null,
        restockedQty: eff.onHandDelta, warehouseInventoryId: inventoryRowId, updatedAt: sql`now()`,
      }).where(eq(schema.customerReturnLines.id, line.id));
    }

    await tx.update(schema.customerReturns).set({
      status: 'completed', qcDoneAt: sql`now()`, qcDoneBy: userId, updatedAt: sql`now()`,
    }).where(eq(schema.customerReturns.id, input.returnId));
  });

  try { await recordAudit({ userId, action: 'return_qc', target: input.returnId, requestSummary: `lines=${input.lines.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/returns');
  revalidatePath(`/f/returns/${input.returnId}`);
}

/** Cancel an 'open' return. Completed returns cannot be cancelled (stock applied). */
export async function cancelReturn(returnId: string): Promise<void> {
  const userId = await requirePerm('manage_returns');
  await db.transaction(async (tx) => {
    const [ret] = await tx.select().from(schema.customerReturns)
      .where(eq(schema.customerReturns.id, returnId)).limit(1);
    if (!ret) throw new Error('Phiếu không tồn tại');
    if (ret.status !== 'open') throw new Error('Chỉ huỷ được phiếu đang mở');
    await tx.update(schema.customerReturns).set({ status: 'cancelled', updatedAt: sql`now()` })
      .where(eq(schema.customerReturns.id, returnId));
  });
  try { await recordAudit({ userId, action: 'return_cancel', target: returnId, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/returns');
}
