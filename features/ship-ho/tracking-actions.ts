'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { emitShipHoEvent } from './mmp-events';
import { requireManageShipHo } from './require-manage';

/** Link tra cứu public cho MMP render cạnh tracking. */
function trackingUrl(carrierKey: string | null, tracking: string): string | null {
  if (carrierKey === 'fedex') return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(tracking)}`;
  if (carrierKey === 'dhl') return `https://www.dhl.com/vn-en/home/tracking.html?tracking-id=${encodeURIComponent(tracking)}`;
  return null;
}

export async function setShipHoTracking(
  orderId: string,
  input: { trackingNumber: string; carrierKey?: 'fedex' | 'dhl' | null },
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
    })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!cur) return { ok: false, error: 'Không tìm thấy đơn' };

  const newCarrier = input.carrierKey !== undefined ? input.carrierKey : cur.carrierKey;
  // Gán tracking → coi như đã gửi, trừ khi đã ở trạng thái cao hơn.
  const bump = cur.status === 'draft' || cur.status === 'quoted';
  await db.update(schema.shipHoOrders).set({
    trackingNumber: tracking,
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
