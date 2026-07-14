'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { emitShipHoEvent } from './mmp-events';

const num = (v: string | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function loadOrderForDecision(orderId: string) {
  const [o] = await db
    .select({
      id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
      source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
      deltaVnd: schema.shipHoOrders.deltaVnd,
      reconcileStatus: schema.shipHoOrders.reconcileStatus,
      reconcileDecision: schema.shipHoOrders.reconcileDecision,
    })
    .from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.id, orderId))
    .limit(1);
  return o ?? null;
}

/**
 * Chấp nhận sai lệch (LỖI NỘI BỘ): chốt giá thu THỰC tính theo bill → đẩy
 * `order.reconciled` sang MMP (giá thu khách chính thức được cập nhật). Idempotent.
 */
export async function acceptShipHoDiscrepancy(orderId: string): Promise<void> {
  const userId = await requireManageShipHo();
  const o = await loadOrderForDecision(orderId);
  if (!o) throw new Error('Đơn không tồn tại.');
  if (o.reconcileStatus !== 'reconciled') throw new Error('Đơn chưa có bill để đối soát.');

  await db
    .update(schema.shipHoOrders)
    .set({ reconcileDecision: 'accepted', reconcileDecisionAt: new Date(), reconcileDecisionBy: userId })
    .where(eq(schema.shipHoOrders.id, orderId));

  const quoted = num(o.chargedVnd);
  const finalChargedVnd = num(o.actualChargedVnd) ?? quoted;
  if (finalChargedVnd != null) {
    await emitShipHoEvent(
      { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
      'order.reconciled',
      {
        finalChargedVnd,
        previousChargedVnd: quoted,
        deltaVnd: quoted == null ? null : finalChargedVnd - quoted,
        reconcileResolution: 'internal_error',
      },
    );
  }
  revalidatePath('/f/ship-ho/reconcile');
}

/**
 * Claim đơn vị vận chuyển: đơn sang 'claiming', đẩy `order.claim_pending` (status
 * "đợi claim đơn vị vận chuyển"). Giá thu khách GIỮ NGUYÊN quote — KHÔNG đẩy
 * order.reconciled (chưa cập nhật giá chính thức tới khi claim xong). Idempotent.
 */
export async function claimShipHoWithCarrier(orderId: string, reason?: string): Promise<void> {
  const userId = await requireManageShipHo();
  const o = await loadOrderForDecision(orderId);
  if (!o) throw new Error('Đơn không tồn tại.');
  if (o.reconcileStatus !== 'reconciled') throw new Error('Đơn chưa có bill để đối soát.');

  const trimmed = reason?.trim() || null;
  await db
    .update(schema.shipHoOrders)
    .set({
      reconcileDecision: 'claiming', reconcileDecisionAt: new Date(),
      reconcileDecisionBy: userId, claimReason: trimmed,
    })
    .where(eq(schema.shipHoOrders.id, orderId));

  await emitShipHoEvent(
    { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
    'order.claim_pending',
    {
      deltaVnd: num(o.deltaVnd),
      estimatedCostVnd: num(o.carrierCostVnd),
      billedCostVnd: num(o.actualCarrierCostVnd),
      reason: trimmed,
    },
  );
  revalidatePath('/f/ship-ho/reconcile');
}

/**
 * KẾT LUẬN claim (đơn đang 'claiming'):
 *   - `credited=true`  → carrier hoàn tiền chênh; decision='claim_credited'.
 *   - `credited=false` → carrier từ chối;          decision='claim_rejected'.
 * Cả hai: giá thu khách chính thức = giá TÍNH LẠI theo bill (actualChargedVnd) →
 * đẩy `order.reconciled`. Chỉ cho phép khi đơn đang 'claiming'.
 */
export async function resolveShipHoClaim(orderId: string, credited: boolean): Promise<void> {
  const userId = await requireManageShipHo();
  const o = await loadOrderForDecision(orderId);
  if (!o) throw new Error('Đơn không tồn tại.');
  if (o.reconcileDecision !== 'claiming') throw new Error('Chỉ kết luận được đơn đang chờ claim.');

  const decision = credited ? 'claim_credited' : 'claim_rejected';
  await db
    .update(schema.shipHoOrders)
    .set({ reconcileDecision: decision, reconcileDecisionAt: new Date(), reconcileDecisionBy: userId })
    .where(eq(schema.shipHoOrders.id, orderId));

  const quoted = num(o.chargedVnd);
  const finalChargedVnd = num(o.actualChargedVnd) ?? quoted;
  if (finalChargedVnd != null) {
    await emitShipHoEvent(
      { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
      'order.reconciled',
      {
        finalChargedVnd,
        previousChargedVnd: quoted,
        deltaVnd: quoted == null ? null : finalChargedVnd - quoted,
        reconcileResolution: decision,
      },
    );
  }
  revalidatePath('/f/ship-ho/reconcile');
}
