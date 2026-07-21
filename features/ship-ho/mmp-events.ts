import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { signMmpPayload } from '@/features/mmp/hmac';
import { planCodeAdoption } from './internal-code';

export type ShipHoEmitOrder = { id: string; code: string; source: string; mmpRef: string | null };
const MAX_ATTEMPTS = 8;

/** THUẦN: dựng envelope webhook. Đơn khởi tạo từ SMS (source 'internal') không có
 *  mmpRef của MMP → dùng CODE SMS làm ref ổn định + origin:'sms' để MMP biết phải
 *  TẠO đơn khi nhận order.received (thay vì lookup). Đơn mmp giữ nguyên shape cũ. */
export function buildEnvelope(
  order: ShipHoEmitOrder, event: string, data: Record<string, unknown>, occurredAtIso: string,
) {
  return {
    event,
    mmpRef: order.mmpRef ?? order.code,
    code: order.code,
    origin: order.source === 'mmp' ? 'mmp' : 'sms',
    occurredAt: occurredAtIso,
    data,
  };
}

/** Ghi 1 event vào outbox rồi thử gửi ngay (best-effort). Gồm CẢ đơn khởi tạo từ
 *  SMS (source 'internal', ref = code) — chỉ đạo CEO 20/07: brand thấy đơn SMS tạo
 *  hộ trên MMP như đơn họ tự tạo. */
export async function emitShipHoEvent(
  order: ShipHoEmitOrder, event: string, data: Record<string, unknown>,
): Promise<void> {
  if (order.source === 'mmp' && !order.mmpRef) return; // đơn mmp thiếu ref (dữ liệu hỏng) — bỏ
  const now = new Date();
  let row;
  try {
    [row] = await db.insert(schema.shipHoOrderEvents).values({
      orderId: order.id, mmpRef: order.mmpRef ?? order.code, code: order.code, event,
      occurredAt: now, payload: data, deliveryStatus: 'pending', attempts: 0,
    }).returning();
  } catch (e) {
    console.warn('[ship-ho] emit outbox insert failed', event, order.code, e);
    return;
  }
  try { await deliverShipHoEvent({ ...row, source: order.source }); } catch (e) { console.warn('[ship-ho] deliver failed (sẽ retry)', event, order.code, e); }
}

/** Gửi 1 event tới MMP; cập nhật delivery_status/attempts. Không throw ra ngoài trừ lỗi lập trình. */
export async function deliverShipHoEvent(row: {
  id: string; orderId?: string; mmpRef: string; code: string; event: string; occurredAt: Date; payload: unknown; attempts: number;
  /** source của đơn ('mmp' | 'internal') → origin envelope. Outbox row không lưu
   *  source nên caller phải truyền (emit có sẵn; retry join ship_ho_orders). */
  source: string;
}): Promise<void> {
  const url = process.env.MMP_SHIP_HO_WEBHOOK_URL;
  // Secret CHUNG 2 chiều với MMP là MMP_WEBHOOK_SECRET (fingerprint ed699da6b1d1
  // — đối chiếu 08/07). MMP_OUTBOUND_SECRET là secret KHÁC (flow brand-requests);
  // ký nhầm bằng nó → MMP 401 toàn bộ event (bug đã gặp).
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!url || !secret) return; // chưa cấu hình → để pending, cron gửi sau

  // Dựng qua buildEnvelope (đường ĐÃ test) — trước đây dựng inline nên thiếu
  // field `origin` dù buildEnvelope có (bug bắt được khi MMP hỏi contract 20/07).
  const envelope = buildEnvelope(
    { id: '', code: row.code, source: row.source, mmpRef: row.mmpRef },
    row.event, row.payload as Record<string, unknown>, row.occurredAt.toISOString(),
  );
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
      // Đơn ORIGIN SMS: MMP là nơi cấp số chính thức (INSLG) — response order.received
      // trả { code } → SMS nhận mã đó làm code+mmpRef; mã operator nhập (reference
      // khách, vd #KLS1996) chuyển vào customerRef. Chỉ đạo CEO 21/07.
      if (row.event === 'order.received' && row.source !== 'mmp' && row.orderId) {
        try {
          const body = (await res.json()) as { code?: unknown };
          const [cur] = await db.select({ code: schema.shipHoOrders.code, customerRef: schema.shipHoOrders.customerRef })
            .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, row.orderId)).limit(1);
          const plan = cur ? planCodeAdoption(cur, body.code) : null;
          if (plan) {
            await db.update(schema.shipHoOrders)
              .set({ code: plan.code, mmpRef: plan.mmpRef, customerRef: plan.customerRef })
              .where(eq(schema.shipHoOrders.id, row.orderId));
            // Event còn pending của đơn → chuyển sang ref mới để retry gửi đúng khoá.
            await db.update(schema.shipHoOrderEvents)
              .set({ mmpRef: plan.mmpRef, code: plan.code })
              .where(and(
                eq(schema.shipHoOrderEvents.orderId, row.orderId),
                eq(schema.shipHoOrderEvents.deliveryStatus, 'pending'),
              ));
            console.log(`[ship-ho] adopt mã MMP: ${cur!.code} → ${plan.code}`);
          }
        } catch { /* response không phải JSON / không có code — bỏ qua */ }
      }
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
  const rows = await db.select({
      ev: schema.shipHoOrderEvents,
      source: schema.shipHoOrders.source,
    }).from(schema.shipHoOrderEvents)
    .innerJoin(schema.shipHoOrders, eq(schema.shipHoOrders.id, schema.shipHoOrderEvents.orderId))
    .where(eq(schema.shipHoOrderEvents.deliveryStatus, 'pending'))
    .limit(200);
  let delivered = 0, failed = 0;
  for (const { ev: r, source } of rows) {
    await deliverShipHoEvent({ id: r.id, orderId: r.orderId, mmpRef: r.mmpRef, code: r.code, event: r.event, occurredAt: r.occurredAt, payload: r.payload, attempts: r.attempts, source });
    const [after] = await db.select({ s: schema.shipHoOrderEvents.deliveryStatus }).from(schema.shipHoOrderEvents).where(eq(schema.shipHoOrderEvents.id, r.id)).limit(1);
    if (after?.s === 'delivered') delivered++; else if (after?.s === 'failed') failed++;
  }
  return { tried: rows.length, delivered, failed };
}
