'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { emitShipHoEvent } from './mmp-events';
import { deliveryStatusToEvent } from './mmp-events-map';
import { orderStatusAfterTrack } from './track';
import { requireManageShipHo } from './require-manage';
import { resolveShippedAt } from './ship-date';

/** Link tra cứu public cho MMP render cạnh tracking. */
function trackingUrl(carrierKey: string | null, tracking: string): string | null {
  if (carrierKey === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`;
  if (carrierKey === 'dhl') return `https://www.dhl.com/vn-en/home/tracking.html?tracking-id=${encodeURIComponent(tracking)}`;
  return null;
}

export async function setShipHoTracking(
  orderId: string,
  input: {
    trackingNumber: string;
    carrierKey?: 'fedex' | 'dhl' | null;
    /** Ngày đi hàng 'YYYY-MM-DD' (Logistic staff chọn). Bỏ trống → giữ ngày đã
     *  có, đơn chưa có → mặc định hôm nay (ngày nhập tracking, giờ VN). */
    shippedAt?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const tracking = input.trackingNumber.trim();
  if (!tracking) return { ok: false, error: 'Thiếu mã tracking' };
  const [cur] = await db
    .select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      source: schema.shipHoOrders.source,
      mmpRef: schema.shipHoOrders.mmpRef,
      service: schema.shipHoOrders.service,
      status: schema.shipHoOrders.status,
      trackingNumber: schema.shipHoOrders.trackingNumber,
      carrierKey: schema.shipHoOrders.carrierKey,
      shippedAt: schema.shipHoOrders.shippedAt,
    })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!cur) return { ok: false, error: 'Không tìm thấy đơn' };

  // Ngày đi hàng: staff chọn > ngày đã có > hôm nay (= ngày nhập tracking).
  const shipped = resolveShippedAt(cur.shippedAt, input.shippedAt);
  if (!shipped.ok) return { ok: false, error: shipped.error };

  const newCarrier = input.carrierKey !== undefined ? input.carrierKey : cur.carrierKey;
  // Gán tracking → coi như đã gửi, trừ khi đã ở trạng thái cao hơn.
  const bump = cur.status === 'draft' || cur.status === 'quoted';
  await db.update(schema.shipHoOrders).set({
    trackingNumber: tracking,
    shippedAt: shipped.value,
    ...(input.carrierKey !== undefined ? { carrierKey: input.carrierKey } : {}),
    ...(bump ? { status: 'shipped' as const } : {}),
  }).where(eq(schema.shipHoOrders.id, orderId));

  // Báo MMP MỌI lần tracking/carrier thay đổi (không chỉ lần đầu) — sửa tracking
  // sau khi đã shipped cũng phải sang MMP để brand thấy mã mới. Payload kèm carrier
  // đã chọn + link tra cứu. Idempotent phía MMP theo occurredAt (bản mới nhất thắng).
  const changed = cur.trackingNumber !== tracking || (input.carrierKey !== undefined && cur.carrierKey !== input.carrierKey);
  if (bump || changed) {
    await emitShipHoEvent(
      { id: cur.id, code: cur.code, source: cur.source, mmpRef: cur.mmpRef },
      'shipment.booked',
      {
        trackingNumber: tracking,
        carrierKey: newCarrier,
        trackingUrl: trackingUrl(newCarrier, tracking),
        service: cur.service ?? 'express',
        ...(cur.trackingNumber && cur.trackingNumber !== tracking ? { previousTrackingNumber: cur.trackingNumber } : {}),
      },
    );
  }
  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true };
}

const MANUAL_STATUSES = ['in_transit', 'out_for_delivery', 'delivered', 'exception'] as const;
export type ManualDeliveryStatus = (typeof MANUAL_STATUSES)[number];

/**
 * Staff SMS update TAY trạng thái giao của đơn ship hộ — dùng khi auto-track chưa
 * khả dụng (FedEx Track API/TrackingMore bị khóa) hoặc có thông tin ngoài luồng.
 * Đi CÙNG đường ray với auto-tracker: đổi trạng thái → bắn event shipment.* sang
 * MMP; delivered → nâng status đơn (không hạ đơn đã billed/settled) + deliveredAt.
 * Auto-tracker sau này có data thật sẽ tự ghi đè (trừ đơn đã delivered).
 */
export async function setShipHoDeliveryStatusManual(
  orderId: string,
  status: ManualDeliveryStatus,
  deliveredAtIso?: string,
): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  if (!MANUAL_STATUSES.includes(status)) return { ok: false, error: 'Trạng thái không hợp lệ' };

  const [o] = await db.select({
    id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
    source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef,
    status: schema.shipHoOrders.status, deliveryStatus: schema.shipHoOrders.deliveryStatus,
  }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'Không tìm thấy đơn' };

  const deliveredAt = status === 'delivered'
    ? (deliveredAtIso && !isNaN(new Date(deliveredAtIso).getTime()) ? new Date(deliveredAtIso) : new Date())
    : undefined;

  await db.update(schema.shipHoOrders).set({
    deliveryStatus: status,
    deliveredAt,
    lastTrackedAt: new Date(),
    status: orderStatusAfterTrack(o.status, status) as typeof o.status,
  }).where(eq(schema.shipHoOrders.id, orderId));

  if (status !== o.deliveryStatus) {
    const evt = deliveryStatusToEvent(status);
    await emitShipHoEvent(
      { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
      evt,
      {
        ...(evt === 'shipment.delivered' ? { deliveredAt: (deliveredAt ?? new Date()).toISOString() } : {}),
        source: 'manual', // ops SMS nhập tay (phân biệt với carrier tracking)
      },
    );
  }

  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true };
}
