'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { emitShipHoEvent } from './mmp-events';
import { requireManageShipHo } from './require-manage';

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
    })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!cur) return { ok: false, error: 'Không tìm thấy đơn' };
  // Gán tracking → coi như đã gửi, trừ khi đã ở trạng thái cao hơn.
  const bump = cur.status === 'draft' || cur.status === 'quoted';
  await db.update(schema.shipHoOrders).set({
    trackingNumber: tracking,
    ...(input.carrierKey !== undefined ? { carrierKey: input.carrierKey } : {}),
    ...(bump ? { status: 'shipped' as const } : {}),
  }).where(eq(schema.shipHoOrders.id, orderId));
  await emitShipHoEvent(
    { id: cur.id, code: cur.code, source: cur.source, mmpRef: cur.mmpRef },
    'shipment.booked',
    { trackingNumber: tracking, service: cur.service ?? 'express' },
  );
  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true };
}
