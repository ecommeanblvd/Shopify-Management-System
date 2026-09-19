/**
 * Báo MMP một đơn ship hộ đã HUỶ vì chưa từng gửi hàng (CEO 19/09/2026).
 *
 * Bối cảnh: đơn chỉ tạo nhãn rồi bỏ (đơn test / brand huỷ) vẫn nằm trên MMP như đơn đang đi,
 * kèm giá đã báo. Gỡ khỏi bảng kê chỉ sửa database phía mình — brand không biết. Sự kiện
 * `order.cancelled` có trong hợp đồng webhook nhưng SMS chưa từng gửi ở đâu.
 *
 * Gọi khi lý do `khong_gui_hang` được hãng XÁC NHẬN (chỉ có sự kiện tạo nhãn). Gửi đúng MỘT
 * lần mỗi đơn — outbox đã có `order.cancelled` thì thôi.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { emitShipHoEvent } from './mmp-events';

export const SU_KIEN_HUY = 'order.cancelled';

export function payloadHuyKhongGuiHang(bangChung: string | null): Record<string, unknown> {
  return {
    reason: 'khong_gui_hang',
    message: 'Chỉ tạo nhãn, chưa gửi hàng — không thu phí',
    chargedVnd: 0,
    ...(bangChung ? { evidence: bangChung } : {}),
  };
}

/** @returns true nếu vừa gửi; false nếu đơn không tồn tại hoặc đã báo huỷ trước đó. */
export async function baoHuyDonKhongGuiHang(orderId: string, bangChung: string | null): Promise<boolean> {
  const [o] = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code, source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return false;
  const [daCo] = await db.select({ id: schema.shipHoOrderEvents.id }).from(schema.shipHoOrderEvents)
    .where(and(eq(schema.shipHoOrderEvents.orderId, orderId), eq(schema.shipHoOrderEvents.event, SU_KIEN_HUY))).limit(1);
  if (daCo) return false;
  await emitShipHoEvent(o, SU_KIEN_HUY, payloadHuyKhongGuiHang(bangChung));
  return true;
}
