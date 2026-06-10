'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { rollupOrderStatus, type LineStatus } from '@/features/fulfillment/logic';
import { recordAudit } from '@/lib/logging/audit';
import { canShipPack, validatePackDims } from './logic';
import { hasWriteFulfillmentsScope } from './shopify-push';
import { pushPackFulfillmentCore } from './push-fulfillment';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requirePerm(perm: Permission): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Unauthorized');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, perm)) throw new Error('Forbidden');
  return session.user.id;
}

async function recomputeRollup(tx: Tx, fulfillmentId: string): Promise<void> {
  const lines = await tx.select({ status: schema.orderFulfillmentLines.status })
    .from(schema.orderFulfillmentLines)
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, fulfillmentId));
  const status = rollupOrderStatus(lines.map((l) => l.status as LineStatus));
  await tx.update(schema.orderFulfillment).set({ status, updatedAt: sql`now()` })
    .where(eq(schema.orderFulfillment.id, fulfillmentId));
}

const num = (v: number | null | undefined) => (v == null ? null : String(v));

export interface CreatePackInput {
  orderId: string;
  lineIds: string[];
  carrierKey?: string | null;
  packagingType?: 'bag' | 'box' | null;
  lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null; weightKg?: number | null;
  originHub?: string | null;
}

/** Create a pack (shipment) from picked lines of an order; assigns them and
 *  moves each to 'packed'. Returns the pack id. */
export async function createPack(input: CreatePackInput): Promise<string> {
  const userId = await requirePerm('manage_fulfillment');
  const dims = validatePackDims(input);
  if (!dims.ok) throw new Error(dims.error);
  if (input.lineIds.length === 0) throw new Error('Chưa chọn dòng nào');

  const packId = await db.transaction(async (tx) => {
    const [ful] = await tx.select({ id: schema.orderFulfillment.id })
      .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, input.orderId)).limit(1);
    if (!ful) throw new Error('No fulfillment record');

    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(and(
        eq(schema.orderFulfillmentLines.fulfillmentId, ful.id),
        inArray(schema.orderFulfillmentLines.id, input.lineIds),
      ))
      .for('update');
    const packable = lines.filter((l) => l.status === 'picked' && l.shipmentId == null);
    if (packable.length === 0) throw new Error('Không có dòng picked hợp lệ để đóng kiện');

    // drizzle node-postgres returns a pg QueryResult ({ rows }); some adapters
    // return the array directly. Handle both shapes.
    const seqRes = await tx.execute(sql`SELECT nextval('pack_code_seq')::bigint AS seq`);
    const seqRows = (((seqRes as unknown) as { rows?: Array<{ seq: string }> }).rows ?? ((seqRes as unknown) as Array<{ seq: string }>));
    if (!seqRows[0]) throw new Error('pack_code_seq trả về rỗng');
    const code = `PK-${seqRows[0].seq}`;

    const [pack] = await tx.insert(schema.shipments).values({
      orderId: input.orderId,
      logUniqueCode: code,
      carrierKey: input.carrierKey?.trim() || null,
      packagingType: input.packagingType ?? null,
      dimLengthCm: num(input.lengthCm), dimWidthCm: num(input.widthCm), dimHeightCm: num(input.heightCm),
      actualWeightKg: num(input.weightKg),
      originHub: input.originHub?.trim() || null,
    }).returning({ id: schema.shipments.id });

    for (const l of packable) {
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: 'packed', packedAt: sql`now()`, shipmentId: pack.id, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: ful.id, lineId: l.id, fromStatus: l.status, toStatus: 'packed', actor: userId, note: `Đóng kiện ${code}`,
      });
    }
    await recomputeRollup(tx, ful.id);
    return pack.id;
  });

  try { await recordAudit({ userId, action: 'pack_create', target: packId, requestSummary: `lines=${input.lineIds.length}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/fulfillment/${input.orderId}`);
  revalidatePath('/f/fulfillment');
  return packId;
}

/** Mark a pack check-packed (separate gated step, required before shipping). */
export async function markCheckPacked(packId: string): Promise<void> {
  const userId = await requirePerm('check_packed');
  const [pack] = await db.select({ orderId: schema.shipments.orderId, checkPackedAt: schema.shipments.checkPackedAt })
    .from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (!pack) throw new Error('Pack not found');
  if (pack.checkPackedAt != null) throw new Error('Kiện đã được check-packed');
  await db.update(schema.shipments)
    .set({ checkPackedBy: userId, checkPackedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(schema.shipments.id, packId));
  try { await recordAudit({ userId, action: 'pack_check', target: packId, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/fulfillment/${pack.orderId}`);
}

/** Ship a pack: requires check-packed + lines; sets tracking and moves lines to shipped. */
export async function shipPack(packId: string, trackingNumber: string): Promise<void> {
  const userId = await requirePerm('manage_fulfillment');
  const tn = trackingNumber.trim();
  if (!tn) throw new Error('Cần nhập tracking number');

  const [scopeRow] = await db.select({ scopes: schema.stores.scopes })
    .from(schema.shipments)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .where(eq(schema.shipments.id, packId)).limit(1);
  if (!scopeRow) throw new Error('Pack not found');
  if (!hasWriteFulfillmentsScope(scopeRow.scopes)) {
    throw new Error('Store chưa cấp scope write_fulfillments — cần re-install store trước khi ship');
  }

  await db.transaction(async (tx) => {
    const [pack] = await tx.select().from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
    if (!pack) throw new Error('Pack not found');
    if (pack.labelCreatedAt != null) throw new Error('Kiện đã được ship');
    const lines = await tx.select().from(schema.orderFulfillmentLines)
      .where(eq(schema.orderFulfillmentLines.shipmentId, packId));
    const gate = canShipPack({ checkPackedAt: pack.checkPackedAt, lineCount: lines.length });
    if (!gate.ok) throw new Error(gate.error);

    await tx.update(schema.shipments)
      .set({ trackingNumber: tn, labelCreatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, packId));

    for (const l of lines) {
      if (l.status === 'shipped') continue;
      await tx.update(schema.orderFulfillmentLines)
        .set({ status: 'shipped', shippedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, l.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: l.fulfillmentId, lineId: l.id, fromStatus: l.status, toStatus: 'shipped', actor: userId, note: `Ship kiện ${pack.logUniqueCode}`,
      });
    }
    await recomputeRollup(tx, lines[0].fulfillmentId);
  });

  try { await recordAudit({ userId, action: 'pack_ship', target: packId, requestSummary: `tracking=${tn}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  await pushPackFulfillmentCore(packId);
  const [s] = await db.select({ orderId: schema.shipments.orderId }).from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
  if (s) revalidatePath(`/f/fulfillment/${s.orderId}`);
  revalidatePath('/f/fulfillment');
}
