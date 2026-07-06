import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpPayload } from '@/features/mmp/hmac';

export type ShipHoEmitOrder = { id: string; code: string; source: string; mmpRef: string | null };
const MAX_ATTEMPTS = 8;

/** THUẦN: dựng envelope webhook. */
export function buildEnvelope(
  order: ShipHoEmitOrder, event: string, data: Record<string, unknown>, occurredAtIso: string,
) {
  return { event, mmpRef: order.mmpRef, code: order.code, occurredAt: occurredAtIso, data };
}

/** Ghi 1 event vào outbox (CHỈ đơn brand) rồi thử gửi ngay (best-effort). No-op cho đơn nội bộ. */
export async function emitShipHoEvent(
  order: ShipHoEmitOrder, event: string, data: Record<string, unknown>,
): Promise<void> {
  if (order.source !== 'mmp' || !order.mmpRef) return;
  const now = new Date();
  let row;
  try {
    [row] = await db.insert(schema.shipHoOrderEvents).values({
      orderId: order.id, mmpRef: order.mmpRef, code: order.code, event,
      occurredAt: now, payload: data, deliveryStatus: 'pending', attempts: 0,
    }).returning();
  } catch (e) {
    console.warn('[ship-ho] emit outbox insert failed', event, order.code, e);
    return;
  }
  try { await deliverShipHoEvent(row); } catch (e) { console.warn('[ship-ho] deliver failed (sẽ retry)', event, order.code, e); }
}

/** Gửi 1 event tới MMP; cập nhật delivery_status/attempts. Không throw ra ngoài trừ lỗi lập trình. */
export async function deliverShipHoEvent(row: {
  id: string; mmpRef: string; code: string; event: string; occurredAt: Date; payload: unknown; attempts: number;
}): Promise<void> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL;
  const secret = process.env.MMP_OUTBOUND_SECRET;
  if (!url || !secret) return; // chưa cấu hình → để pending, cron gửi sau

  const envelope = {
    event: row.event, mmpRef: row.mmpRef, code: row.code,
    occurredAt: row.occurredAt.toISOString(), data: row.payload,
  };
  const rawBody = JSON.stringify(envelope);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signMmpPayload(secret, ts, rawBody);

  const attempts = row.attempts + 1;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mean-signature': signature, 'x-mean-timestamp': String(ts) },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      await db.update(schema.shipHoOrderEvents)
        .set({ deliveryStatus: 'delivered', attempts, lastAttemptAt: new Date(), lastError: null })
        .where(eq(schema.shipHoOrderEvents.id, row.id));
      return;
    }
    throw new Error(`http ${res.status}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    await db.update(schema.shipHoOrderEvents)
      .set({ deliveryStatus: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, lastAttemptAt: new Date(), lastError: msg })
      .where(eq(schema.shipHoOrderEvents.id, row.id));
  }
}

/** Cron: gửi lại các event chưa 'delivered' (pending/failed) dưới ngưỡng. */
export async function retryPendingShipHoEvents(): Promise<{ tried: number; delivered: number; failed: number }> {
  const rows = await db.select().from(schema.shipHoOrderEvents)
    .where(eq(schema.shipHoOrderEvents.deliveryStatus, 'pending'))
    .limit(200);
  let delivered = 0, failed = 0;
  for (const r of rows) {
    await deliverShipHoEvent({ id: r.id, mmpRef: r.mmpRef, code: r.code, event: r.event, occurredAt: r.occurredAt, payload: r.payload, attempts: r.attempts });
    const [after] = await db.select({ s: schema.shipHoOrderEvents.deliveryStatus }).from(schema.shipHoOrderEvents).where(eq(schema.shipHoOrderEvents.id, r.id)).limit(1);
    if (after?.s === 'delivered') delivered++; else if (after?.s === 'failed') failed++;
  }
  return { tried: rows.length, delivered, failed };
}
