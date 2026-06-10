'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, sql, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { rollupOrderStatus, type LineStatus } from '@/features/fulfillment/logic';
import { recordAudit } from '@/lib/logging/audit';
import { putObject } from '@/lib/storage/s3';
import { decideDisposition, validateQc, inventoryEffect, nextSeqCode, parseSeq, type SourceType, type QcResult } from './logic';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

/** Retry a unit-of-work on a Postgres unique-violation (23505) — covers the
 *  read-max-then-insert race on generated sequential codes. */
async function withUniqueRetry<R>(fn: () => Promise<R>, attempts = 4): Promise<R> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const code = (e as { code?: string; cause?: { code?: string } })?.code
        ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code === '23505' && i < attempts - 1) continue;
      throw e;
    }
  }
  throw new Error('unreachable');
}

async function recomputeRollup(tx: Tx, fulfillmentId: string): Promise<void> {
  const lines = await tx.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await tx.update(schema.orderFulfillment).set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

/** Upload an image to S3 under a receipts/ prefix; returns the object key. */
export async function uploadReceiptImage(formData: FormData): Promise<string> {
  await requirePerm('manage_receiving');
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('No file');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const scope = String(formData.get('scope') ?? 'tmp').replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `receipts/${scope}/${Date.now()}-${safe}`;
  await putObject(key, bytes, file.type || 'application/octet-stream');
  return key;
}

export interface CreateReceiptInput {
  sourceType: SourceType; vendor?: string | null; warehouseCode?: string | null;
  handoverDocKey?: string | null; note?: string | null;
}

/** Create a receipt header with an auto-generated GRN code. Returns its id. */
export async function createReceipt(input: CreateReceiptInput): Promise<string> {
  const userId = await requirePerm('manage_receiving');
  const id = await withUniqueRetry(() => db.transaction(async (tx) => {
    const [last] = await tx.select({ code: schema.goodsReceipts.code })
      .from(schema.goodsReceipts).orderBy(desc(schema.goodsReceipts.code)).limit(1);
    const code = nextSeqCode('GRN', parseSeq('GRN', last?.code ?? null));
    const [row] = await tx.insert(schema.goodsReceipts).values({
      code, sourceType: input.sourceType, vendor: input.vendor ?? null,
      warehouseCode: input.warehouseCode?.trim() || 'HN',
      handoverDocKey: input.handoverDocKey ?? null, note: input.note ?? null, receivedBy: userId,
    }).returning({ id: schema.goodsReceipts.id });
    return row.id;
  }));
  try { await recordAudit({ userId, action: 'receiving_create', target: id, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/fulfillment/receiving');
  return id;
}

export interface AddReceiptItemInput {
  receiptId: string;
  sku?: string | null; productTitle?: string | null; variantTitle?: string | null; photoKey?: string | null;
  brandRequestId?: string | null; fulfillmentLineId?: string | null; orderId?: string | null;
  domPrice?: string | null; domPriceCurrency?: string | null;
  globalPrice?: string | null; globalPriceCurrency?: string | null; weightKg?: string | null;
}

/** Add one physical unit (auto WH unit code) to a receipt. Returns its id. */
export async function addReceiptItem(input: AddReceiptItemInput): Promise<string> {
  const userId = await requirePerm('manage_receiving');
  const id = await withUniqueRetry(() => db.transaction(async (tx) => {
    const [last] = await tx.select({ unitCode: schema.goodsReceiptItems.unitCode })
      .from(schema.goodsReceiptItems).orderBy(desc(schema.goodsReceiptItems.unitCode)).limit(1);
    const unitCode = nextSeqCode('WH', parseSeq('WH', last?.unitCode ?? null));
    const [row] = await tx.insert(schema.goodsReceiptItems).values({
      receiptId: input.receiptId, unitCode,
      sku: input.sku?.trim() || null, productTitle: input.productTitle ?? null, variantTitle: input.variantTitle ?? null,
      photoKey: input.photoKey ?? null,
      brandRequestId: input.brandRequestId ?? null, fulfillmentLineId: input.fulfillmentLineId ?? null, orderId: input.orderId ?? null,
      domPrice: input.domPrice ?? null, domPriceCurrency: input.domPriceCurrency ?? null,
      globalPrice: input.globalPrice ?? null, globalPriceCurrency: input.globalPriceCurrency ?? null, weightKg: input.weightKg ?? null,
    }).returning({ id: schema.goodsReceiptItems.id });
    return row.id;
  }));
  try { await recordAudit({ userId, action: 'receiving_add_item', target: id, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/fulfillment/receiving/${input.receiptId}`);
  return id;
}

export interface RecordQcInput {
  itemId: string; qcResult: QcResult;
  qcFailReason?: string | null; qcFailPhotoKey?: string | null; vendorReturnDocKey?: string | null;
}

/** Record a QC result and apply its disposition: pass-for-order allocates to the
 *  order line; pass-for-stock increments on-hand; fail reopens the brand request. */
export async function recordQc(input: RecordQcInput): Promise<void> {
  const userId = await requirePerm('manage_qc');
  const v = validateQc(input);
  if (!v.ok) throw new Error(v.error);

  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(schema.goodsReceiptItems)
      .where(eq(schema.goodsReceiptItems.id, input.itemId)).limit(1);
    if (!item) throw new Error('Item not found');
    if (item.qcResult !== 'pending') throw new Error('Đơn vị này đã QC');
    const [receipt] = await tx.select({ sourceType: schema.goodsReceipts.sourceType })
      .from(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, item.receiptId)).limit(1);
    if (!receipt) throw new Error('Receipt not found');

    let disposition = decideDisposition(receipt.sourceType as SourceType, input.qcResult);

    const line = item.fulfillmentLineId
      ? (await tx.select().from(schema.orderFulfillmentLines)
          .where(eq(schema.orderFulfillmentLines.id, item.fulfillmentLineId)).limit(1))[0]
      : undefined;

    // Surplus guard: a pass meant to allocate, but the line is no longer
    // awaiting goods (already satisfied) -> divert this good unit to stock.
    const ALLOCATABLE = new Set(['brand_confirmed', 'brand_requested', 'out_of_stock', 'pending_check']);
    if (disposition === 'allocate_to_order' && (!line || !ALLOCATABLE.has(line.status as string))) {
      disposition = 'store';
    }

    const hasSku = !!item.sku;
    const eff = inventoryEffect(disposition, hasSku);

    await tx.update(schema.goodsReceiptItems).set({
      qcResult: input.qcResult, qcFailReason: input.qcFailReason ?? null, qcFailPhotoKey: input.qcFailPhotoKey ?? null,
      vendorReturnDocKey: input.vendorReturnDocKey ?? null, disposition,
      qcCheckedBy: userId, qcCheckedAt: sql`now()`, updatedAt: sql`now()`,
    }).where(eq(schema.goodsReceiptItems.id, item.id));

    let inventoryRowId: string | null = null;
    if (hasSku && (eff.onHandDelta !== 0 || eff.reservedDelta !== 0)) {
      const [inv] = await tx.insert(schema.warehouseInventory)
        .values({ sku: item.sku!, productTitle: item.productTitle, variantTitle: item.variantTitle,
                  qtyOnHand: eff.onHandDelta, qtyReserved: eff.reservedDelta, updatedBy: userId })
        .onConflictDoUpdate({
          target: schema.warehouseInventory.sku,
          set: {
            qtyOnHand: sql`${schema.warehouseInventory.qtyOnHand} + ${eff.onHandDelta}`,
            qtyReserved: sql`${schema.warehouseInventory.qtyReserved} + ${eff.reservedDelta}`,
            updatedBy: userId, updatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.warehouseInventory.id });
      inventoryRowId = inv.id;
    }

    if (disposition === 'allocate_to_order' && line) {
      await tx.update(schema.orderFulfillmentLines).set({
        status: 'in_stock', warehouseInventoryId: inventoryRowId, allocatedQty: line.qty, updatedAt: sql`now()`,
      }).where(eq(schema.orderFulfillmentLines.id, line.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: line.fulfillmentId, lineId: line.id, fromStatus: line.status, toStatus: 'in_stock',
        actor: userId, note: `Nhận hàng ${item.unitCode} QC pass`,
      });
      await recomputeRollup(tx, line.fulfillmentId);
    } else if (disposition === 'return_to_brand' && line) {
      await tx.update(schema.orderFulfillmentLines).set({ status: 'brand_requested', updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, line.id));
      const [ful] = await tx.select({ orderId: schema.orderFulfillment.orderId })
        .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.id, line.fulfillmentId)).limit(1);
      const reopenOrderId = item.orderId ?? ful?.orderId ?? null;
      if (reopenOrderId) {
        await tx.insert(schema.brandOrderRequests).values({
          fulfillmentLineId: line.id, orderId: reopenOrderId, sku: line.sku, qty: line.qty, confirmStatus: 'awaiting',
        }).onConflictDoUpdate({
          target: schema.brandOrderRequests.fulfillmentLineId,
          set: {
            confirmStatus: 'awaiting', expectedDeliveryDate: null,
            note: sql`coalesce(${schema.brandOrderRequests.note}, '') || ${'\nQC fail: ' + (input.qcFailReason ?? '')}`,
            updatedAt: sql`now()`,
          },
        });
      }
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: line.fulfillmentId, lineId: line.id, fromStatus: line.status, toStatus: 'brand_requested',
        actor: userId, note: `QC fail ${item.unitCode}: ${input.qcFailReason ?? ''}`,
      });
      await recomputeRollup(tx, line.fulfillmentId);
    }
  });

  try { await recordAudit({ userId, action: 'receiving_qc', target: input.itemId, requestSummary: `result=${input.qcResult}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath('/f/fulfillment/receiving');
  revalidatePath('/f/fulfillment');
}
