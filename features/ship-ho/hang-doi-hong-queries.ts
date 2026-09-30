/**
 * Đọc hàng đợi gửi MMP để dựng cảnh báo. CỐ Ý KHÔNG có `'use server'`: hàm chạy phía máy chủ
 * dùng chung, không phải endpoint cho trình duyệt gọi (cùng lý do ở `bang-ke-khoan-phi-queries`).
 */
import { ne, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { tomTatHangDoiHong, type SuKienKetThat, type TomTatHangDoi } from './hang-doi-hong';
import type { SuKienDaGui } from './event-obsolete';

export async function hangDoiHongShipHo(): Promise<TomTatHangDoi> {
  const ket = await db.select({
    orderId: schema.shipHoOrderEvents.orderId,
    event: schema.shipHoOrderEvents.event,
    occurredAt: schema.shipHoOrderEvents.occurredAt,
    lastError: schema.shipHoOrderEvents.lastError,
    lastHttpStatus: schema.shipHoOrderEvents.lastHttpStatus,
    code: schema.shipHoOrders.code,
    brandReference: schema.shipHoOrders.brandReference,
  })
    .from(schema.shipHoOrderEvents)
    .innerJoin(schema.shipHoOrders, eq(schema.shipHoOrders.id, schema.shipHoOrderEvents.orderId))
    .where(ne(schema.shipHoOrderEvents.deliveryStatus, 'delivered'));
  if (ket.length === 0) return { tong: 0, nhom: [], cuNhat: null };

  // Sự kiện ĐÃ GỬI của chính các đơn đó — để loại bản đã bị vượt (xem event-obsolete).
  const ids = [...new Set(ket.map((k) => k.orderId).filter((v): v is string => v != null))];
  const daGui = ids.length === 0 ? [] : await db.select({
    orderId: schema.shipHoOrderEvents.orderId,
    event: schema.shipHoOrderEvents.event,
    occurredAt: schema.shipHoOrderEvents.occurredAt,
  })
    .from(schema.shipHoOrderEvents)
    .where(inArray(schema.shipHoOrderEvents.orderId, ids));
  const theoDon = new Map<string, SuKienDaGui[]>();
  for (const d of daGui) {
    if (!d.orderId) continue;
    const a = theoDon.get(d.orderId) ?? [];
    a.push({ event: d.event, occurredAt: d.occurredAt });
    theoDon.set(d.orderId, a);
  }
  const rows: SuKienKetThat[] = ket.filter((k) => k.orderId != null).map((k) => ({
    orderId: k.orderId!, code: k.code, brandReference: k.brandReference,
    event: k.event, occurredAt: k.occurredAt,
    lastError: k.lastError, lastHttpStatus: k.lastHttpStatus,
  }));
  return tomTatHangDoiHong(rows, theoDon);
}
